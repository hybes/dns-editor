import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { normaliseLookupName } from '../utils/domainNames'
import { dohQuery } from '../utils/doh'
import {
	PROPAGATION_TYPES,
	PUBLIC_RESOLVERS,
	EMPTY_STATUSES,
	queryServer,
	normaliseExpected,
	containsExpected,
	sameValues,
	soaSerial
} from '../utils/dnsResolve'

// Propagation check: the zone's own nameservers give the answer that should exist,
// and a spread of public resolvers shows who has picked it up yet. When the caller
// knows the value they just set, that is used as the reference instead.

const MAX_NAMESERVERS = 6
const MAX_EXPECTED_LENGTH = 512

// Find the zone apex for a name using the SOA in the answer or authority section.
// Works even when the name itself does not exist yet, which is the usual case right
// after creating a record.
const findZoneApex = async (name) => {
	const soa = await dohQuery({ resolver: 'cloudflare', name, type: 'SOA' })
	if (!soa.ok) return { apex: '', error: soa.error }
	const owner = [...soa.answers, ...soa.authority].find((record) => record.type === 'SOA')
	if (!owner) return { apex: '', error: 'No SOA record was found for this name' }
	return { apex: owner.name, error: '' }
}

const findNameservers = async (apex) => {
	const ns = await dohQuery({ resolver: 'cloudflare', name: apex, type: 'NS' })
	if (!ns.ok) return { hosts: [], error: ns.error }
	const hosts = ns.answers
		.filter((record) => record.type === 'NS')
		.map((record) => record.data.replace(/\.$/, '').toLowerCase())
	return { hosts: [...new Set(hosts)].sort().slice(0, MAX_NAMESERVERS), error: '' }
}

const resolveHostAddress = async (host) => {
	const a = await dohQuery({ resolver: 'cloudflare', name: host, type: 'A' })
	const record = a.ok ? a.answers.find((r) => r.type === 'A') : null
	return record ? record.data : ''
}

// What a server "says" for comparison: its values, an empty set for a definite
// nothing, or null when the query itself failed.
const comparable = (result) => {
	if (result.ok) return result.values
	if (EMPTY_STATUSES.has(result.status)) return []
	return null
}

const judge = (result, reference) => {
	if (!reference) return null
	const values = comparable(result)
	if (values === null) return null
	if (reference.source === 'expected') return containsExpected(values, reference.expected)
	return sameValues(values, reference.values)
}

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		const parsed = normaliseLookupName(body.name)
		if (parsed.error) throw createError({ statusCode: 400, statusMessage: parsed.error })

		let type = typeof body.type === 'string' ? body.type.trim().toUpperCase() : 'A'
		if (parsed.reverse) type = 'PTR'
		if (!PROPAGATION_TYPES.includes(type)) {
			throw createError({ statusCode: 400, statusMessage: `Unsupported record type: ${type}` })
		}

		const rawExpected = typeof body.expected === 'string' ? body.expected : ''
		if (rawExpected.length > MAX_EXPECTED_LENGTH) {
			throw createError({ statusCode: 400, statusMessage: 'Expected value is too long.' })
		}
		const expected = normaliseExpected(type, rawExpected)

		// Kick off the public-resolver queries straight away; zone discovery runs alongside.
		const resolverQueries = Promise.all(
			PUBLIC_RESOLVERS.map(async (resolver) => ({
				...resolver,
				...(await queryServer({ ip: resolver.ip, name: parsed.name, type }))
			}))
		)

		const zone = { apex: '', nameservers: [], agree: null, error: '' }
		const { apex, error: apexError } = await findZoneApex(parsed.name)
		zone.apex = apex
		if (!apex) {
			zone.error = apexError || 'Could not work out which zone this name belongs to'
		} else if (!apex.includes('.')) {
			// The closest SOA is a TLD's: the domain itself is not delegated anywhere.
			zone.error = `${parsed.name} is not inside a delegated zone; the closest one is the .${apex} registry itself`
		} else {
			const { hosts, error: nsError } = await findNameservers(apex)
			if (!hosts.length) {
				zone.error = nsError || `No nameservers are published for ${apex}`
			} else {
				zone.nameservers = await Promise.all(
					hosts.map(async (host) => {
						const ip = await resolveHostAddress(host)
						if (!ip) {
							return {
								host,
								ip: '',
								ok: false,
								status: 'error',
								values: [],
								ttl: null,
								serial: null,
								durationMs: 0,
								error: 'No address found for this nameserver'
							}
						}
						const [answer, soa] = await Promise.all([
							queryServer({ ip, name: parsed.name, type }),
							queryServer({ ip, name: apex, type: 'SOA' })
						])
						return { host, ip, ...answer, serial: soa.ok ? soaSerial(soa.values) : null }
					})
				)
				const answered = zone.nameservers.map(comparable).filter((values) => values !== null)
				zone.agree = answered.length > 1 ? answered.every((values) => sameValues(values, answered[0])) : null
			}
		}

		let reference = null
		if (expected) {
			reference = { source: 'expected', expected, values: [expected] }
		} else {
			const consensus = zone.nameservers.map(comparable).find((values) => values !== null)
			if (consensus) reference = { source: 'authoritative', expected: '', values: consensus }
		}

		const resolvers = (await resolverQueries).map((result) => ({ ...result, match: judge(result, reference) }))
		for (const server of zone.nameservers) server.match = judge(server, reference)

		const matched = resolvers.filter((r) => r.match === true).length
		const stale = resolvers.filter((r) => r.match === false).length
		const unknown = resolvers.length - matched - stale
		const staleTtls = resolvers.filter((r) => r.match === false && Number.isFinite(r.ttl)).map((r) => r.ttl)

		let state = 'unknown'
		if (reference && matched + stale > 0) {
			if (stale === 0) state = 'propagated'
			else if (matched === 0) state = 'none'
			else state = 'partial'
		}

		return {
			success: true,
			result: {
				input: parsed.original,
				name: parsed.name,
				reverse: parsed.reverse,
				type,
				reference,
				zone,
				resolvers,
				summary: {
					state,
					total: resolvers.length,
					matched,
					stale,
					unknown,
					maxStaleTtl: staleTtls.length ? Math.max(...staleTtls) : null
				},
				checkedAt: new Date().toISOString()
			}
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Propagation check failed: ${error?.message || 'Unknown error'}`
		})
	}
})
