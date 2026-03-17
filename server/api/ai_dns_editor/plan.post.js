import OpenAI from 'openai'
import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { buildDnsPlan, dnsPlanSchema, fetchAllDnsRecords } from '../../utils/dnsEditor'

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

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)
		const config = useRuntimeConfig(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		if (!body.currZone) {
			throw createError({ statusCode: 400, statusMessage: 'Zone ID is required' })
		}

		if (!body.zoneName) {
			throw createError({ statusCode: 400, statusMessage: 'Zone name is required' })
		}

		if (!body.input || !String(body.input).trim()) {
			throw createError({ statusCode: 400, statusMessage: 'DNS instructions are required' })
		}

		if (!config.openaiApiKey) {
			throw createError({ statusCode: 503, statusMessage: 'OPENAI_API_KEY is not configured on the server' })
		}

		const client = new OpenAI({ apiKey: config.openaiApiKey })
		const completion = await client.chat.completions.create({
			model: config.openaiDnsModel || 'gpt-5.4-nano',
			reasoning_effort: 'none',
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{
					role: 'user',
					content: `Zone: ${body.zoneName}\n\nPaste:\n${String(body.input).trim()}`
				}
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

		const payload = completion.choices?.[0]?.message?.content
		if (!payload) {
			throw createError({ statusCode: 502, statusMessage: 'OpenAI did not return a DNS plan' })
		}

		const parsed = JSON.parse(payload)
		const existingRecords = await fetchAllDnsRecords({
			apiKey: body.apiKey,
			zoneId: body.currZone,
			cacheTtl: 15000
		})

		if (!existingRecords?.success) {
			throw createError({
				statusCode: 502,
				statusMessage: existingRecords?.errors?.[0]?.message || 'Failed to load current DNS records'
			})
		}

		return {
			success: true,
			result: buildDnsPlan({
				proposedRecords: parsed.records || [],
				existingRecords: existingRecords.result || [],
				zoneName: body.zoneName,
				warnings: parsed.warnings || [],
				summary: parsed.summary || ''
			})
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Failed to prepare AI DNS plan'
		})
	}
})
