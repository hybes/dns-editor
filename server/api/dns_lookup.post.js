import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { normaliseLookupName } from '../utils/domainNames'
import { dohQuery, RECORD_TYPES, COMMON_RECORD_TYPES, RESOLVERS, RESOLVER_IDS } from '../utils/doh'

// Public-resolver lookup. Deliberately independent of the Cloudflare token so it can
// show what the rest of the internet currently sees for a name.

const pickResolvers = (input) => {
	const requested = Array.isArray(input) ? input.filter((id) => RESOLVER_IDS.includes(id)) : []
	return requested.length ? [...new Set(requested)] : RESOLVER_IDS
}

const mergeQueries = (results) => {
	const okResults = results.filter((r) => r.ok)
	if (!okResults.length) {
		return {
			ok: false,
			error: results[0]?.error || 'Lookup failed',
			durationMs: Math.max(...results.map((r) => r.durationMs))
		}
	}
	const statuses = okResults.map((r) => r.status)
	const seen = new Set()
	const answers = []
	for (const result of okResults) {
		for (const record of result.answers) {
			const key = `${record.name}|${record.type}|${record.data}`
			if (seen.has(key)) continue
			seen.add(key)
			answers.push(record)
		}
	}
	const failed = results.filter((r) => !r.ok)
	return {
		ok: true,
		status: statuses.includes('NOERROR') ? 'NOERROR' : statuses[0],
		dnssec: okResults.every((r) => r.dnssec),
		truncated: okResults.some((r) => r.truncated),
		answers,
		authority: answers.length ? [] : okResults[0].authority,
		comment: failed.length ? `${failed.length} of ${results.length} record-type queries failed` : '',
		durationMs: Math.max(...results.map((r) => r.durationMs))
	}
}

const answerSignature = (answers) =>
	answers
		.map((record) => `${record.type} ${record.data}`)
		.sort()
		.join('\n')

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		const parsed = normaliseLookupName(body.name)
		if (parsed.error) throw createError({ statusCode: 400, statusMessage: parsed.error })

		let type = typeof body.type === 'string' ? body.type.trim().toUpperCase() : 'A'
		if (parsed.reverse && type !== 'PTR') type = 'PTR'
		if (type !== 'ALL' && !RECORD_TYPES.includes(type)) {
			throw createError({ statusCode: 400, statusMessage: `Unsupported record type: ${type}` })
		}

		const types = type === 'ALL' ? COMMON_RECORD_TYPES : [type]
		const resolverIds = pickResolvers(body.resolvers)

		const resolvers = await Promise.all(
			resolverIds.map(async (id) => {
				const queries = await Promise.all(
					types.map((t) => dohQuery({ resolver: id, name: parsed.name, type: t }))
				)
				const merged = types.length === 1 ? queries[0] : mergeQueries(queries)
				const { label, address } = RESOLVERS[id]
				return { id, label, address, ...merged }
			})
		)

		const comparable = resolvers.filter((r) => r.ok)
		const signatures = new Set(comparable.map((r) => answerSignature(r.answers)))
		const agreement = {
			compared: comparable.length > 1,
			matches: comparable.length > 1 ? signatures.size === 1 : null
		}

		return {
			success: true,
			result: {
				input: parsed.original,
				name: parsed.name,
				reverse: parsed.reverse,
				type,
				types,
				resolvers,
				agreement,
				checkedAt: new Date().toISOString()
			}
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `DNS lookup failed: ${error?.message || 'Unknown error'}`
		})
	}
})
