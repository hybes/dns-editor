import OpenAI from 'openai'
import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { cfFetch } from '../../utils/cfFetch'
import { buildDnsPlan, dnsPlanSchema, fetchAllDnsRecords } from '../../utils/dnsEditor'
import { readId } from '../../utils/ids'

// Keeps a stray paste of a whole document from turning into a large OpenAI bill.
const MAX_INPUT_LENGTH = 20_000

const SYSTEM_PROMPT = `You extract actionable DNS records from pasted setup instructions.

Rules:
- Only return records that are explicitly present in the pasted text.
- Only return standard Cloudflare-friendly records using these types: A, AAAA, CNAME, MX, TXT.
- Ignore headings, prose, statuses, and duplicate rows.
- Use the provided zone name to keep names inside the zone.
- Preserve TXT values exactly, but remove wrapping quotes only if they are clearly just delimiters.
- Set proxied to false unless the pasted instructions clearly indicate proxying for a web-facing A, AAAA, or CNAME record.
- Set ttl to 1 unless an explicit TTL is present.
- For MX records, capture the numeric priority when present.
- If some lines look incomplete or unsupported, leave them out of records and explain that in warnings.
- Do not invent records or values.
- Keep the summary brief and practical.`

// Failures from Cloudflare go back as its own envelope so the page shows Cloudflare's
// message and can recognise a rejected token.
const cloudflareFailure = (data, fallback) => ({
	success: false,
	errors: data?.errors?.length ? data.errors : [{ message: fallback }]
})

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)
		const config = useRuntimeConfig(event)
		const input = String(body.input || '').trim()

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		if (!input) {
			throw createError({ statusCode: 400, statusMessage: 'Paste the DNS instructions you want to analyse' })
		}

		if (input.length > MAX_INPUT_LENGTH) {
			throw createError({
				statusCode: 400,
				statusMessage: `That text is too long. Paste up to ${MAX_INPUT_LENGTH.toLocaleString('en-GB')} characters at a time.`
			})
		}

		if (!config.openaiApiKey) {
			throw createError({
				statusCode: 503,
				statusMessage: 'The AI editor isn’t set up on this server. Set OPENAI_API_KEY and restart it.'
			})
		}

		// Use the zone's real name rather than whatever the page sent, so proposed names
		// always stay inside this zone.
		const zoneData = await cfFetch({
			apiKey: body.apiKey,
			method: 'GET',
			path: `/zones/${zoneId}`,
			cacheTtl: 15000
		})

		if (!zoneData?.success || !zoneData.result?.name) {
			return cloudflareFailure(zoneData, 'Couldn’t load this zone from Cloudflare')
		}

		const zoneName = zoneData.result.name
		const client = new OpenAI({ apiKey: config.openaiApiKey })

		const [completion, existingRecords] = await Promise.all([
			client.chat.completions
				.create({
					model: config.openaiDnsModel || 'gpt-5.4-nano',
					reasoning_effort: 'none',
					messages: [
						{ role: 'system', content: SYSTEM_PROMPT },
						{ role: 'user', content: `Zone: ${zoneName}\n\nPaste:\n${input}` }
					],
					response_format: {
						type: 'json_schema',
						json_schema: {
							name: 'dns_editor_plan',
							strict: true,
							schema: dnsPlanSchema
						}
					}
				})
				.catch((error) => {
					// OpenAI's own message (bad key, quota, unknown model) is what the operator needs.
					throw createError({
						statusCode: 502,
						statusMessage: `OpenAI couldn’t prepare a plan: ${error?.message || 'unknown error'}`
					})
				}),
			fetchAllDnsRecords({ apiKey: body.apiKey, zoneId, cacheTtl: 15000 })
		])

		if (!existingRecords?.success) {
			return cloudflareFailure(existingRecords, 'Couldn’t load the zone’s current DNS records')
		}

		let parsed
		try {
			parsed = JSON.parse(completion.choices?.[0]?.message?.content || '')
		} catch {
			throw createError({
				statusCode: 502,
				statusMessage: 'OpenAI returned a plan this server couldn’t read. Try again.'
			})
		}

		const warnings = [...(parsed.warnings || [])]
		// Matching against an incomplete list can mark existing records as missing or miss a
		// conflict, so the plan says so.
		if (existingRecords.partial) {
			warnings.unshift(`${existingRecords.message} Some changes may already exist or conflict.`)
		}

		return {
			success: true,
			result: buildDnsPlan({
				proposedRecords: parsed.records || [],
				existingRecords: existingRecords.result || [],
				zoneName,
				warnings,
				summary: parsed.summary || ''
			})
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Couldn’t prepare a plan: ${error?.message || 'unknown error'}`
		})
	}
})
