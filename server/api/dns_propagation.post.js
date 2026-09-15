import { randomBytes } from 'node:crypto'
import { createError } from 'h3'
import { PROPAGATION_TYPES } from '#shared/utils/dnsTypes'
import { readJsonBody } from '../utils/readJsonBody'
import { normaliseLookupName } from '../utils/domainNames'
import { dohQuery } from '../utils/doh'
import {
	PUBLIC_RESOLVERS,
	EMPTY_STATUSES,
	QUERY_TIMEOUT_MS,
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
// Well above the longest TXT content Cloudflare accepts, so a 4096-bit DKIM key fits.
const MAX_EXPECTED_LENGTH = 4096
// Zone discovery is a few lookups in a row, so each gets less time than a normal lookup
// to keep the whole check to about 20 seconds when a resolver is slow.
const DISCOVERY_TIMEOUT_MS = 5000

const isWithin = (name, zone) => name === zone || name.endsWith(`.${zone}`)

// Find the zone apex for a name using the SOA in the answer or authority section.
// Works even when the name itself does not exist yet, which is the usual case right
// after creating a record. Only an SOA at or above the name counts: for a CNAME the
// resolver follows the alias and reports the target's zone, so the parent name is asked
// about instead until the name's own zone turns up.
const findZoneApex = async (name) => {
	let current = name
	for (;;) {
		const soa = await dohQuery({
			resolver: 'cloudflare',
			name: current,
			type: 'SOA',
			timeoutMs: DISCOVERY_TIMEOUT_MS
		})
		if (!soa.ok) return { apex: '', error: soa.error }
		const records = [...soa.answers, ...soa.authority]
		const owner = records.find((record) => record.type === 'SOA' && isWithin(current, record.name))
		if (owner) return { apex: owner.name, error: '' }
		const aliased = records.some((record) => record.type === 'CNAME' && record.name === current)
		const parent = current.slice(current.indexOf('.') + 1)
		if (!aliased || parent === current || !parent.includes('.')) {
			return { apex: '', error: 'No SOA record was found for this name' }
		}
		current = parent
	}
}

const findNameservers = async (apex) => {
	const ns = await dohQuery({ resolver: 'cloudflare', name: apex, type: 'NS', timeoutMs: DISCOVERY_TIMEOUT_MS })
	if (!ns.ok) return { hosts: [], error: ns.error }
	const hosts = ns.answers
		.filter((record) => record.type === 'NS')
		.map((record) => record.data.replace(/\.$/, '').toLowerCase())
	return { hosts: [...new Set(hosts)].sort().slice(0, MAX_NAMESERVERS), error: '' }
}

const resolveHostAddress = async (host) => {
	const a = await dohQuery({ resolver: 'cloudflare', name: host, type: 'A', timeoutMs: DISCOVERY_TIMEOUT_MS })
	const record = a.ok ? a.answers.find((r) => r.type === 'A') : null
	return record ? record.data : ''
}

// queryServer refuses private and internal addresses itself, so a zone whose NS records
// point inside this server's network gets a "not queried" row rather than a probe.
const queryNameserver = async ({ host, name, apex, type }) => {
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
		queryServer({ ip, name, type }),
		queryServer({ ip, name: apex, type: 'SOA' })
	])
	const row = { host, ip, ...answer, serial: soa.ok ? soaSerial(soa.values) : null }
	// A nameserver doesn't follow an alias into another zone, so a CNAME answers every other
	// type with nothing. Ask for the CNAME itself so the row isn't read as a missing record.
	const empty = answer.ok ? !answer.values.length : EMPTY_STATUSES.has(answer.status)
	if (type !== 'CNAME' && empty) {
		const alias = await queryServer({ ip, name, type: 'CNAME' })
		if (alias.ok && alias.values.length) row.cname = alias.values[0]
	}
	return row
}

// What a server "says" for comparison: its values, an empty set for a definite
// nothing, or null when the query itself failed. A nameserver that answers with a CNAME
// has no records of the asked-for type to compare, so that is null too.
const comparable = (result) => {
	if (result.cname) return null
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

		const parsed = normaliseLookupName(body.name, { allowWildcard: true })
		if (parsed.error) throw createError({ statusCode: 400, statusMessage: parsed.error })

		let type = typeof body.type === 'string' ? body.type.trim().toUpperCase() : 'A'
		if (parsed.reverse) type = 'PTR'
		if (!PROPAGATION_TYPES.includes(type)) {
			throw createError({
				statusCode: 400,
				statusMessage: `${type ? `${type} records` : 'That record type'} can’t be checked for propagation. DNS Lookup can show what public resolvers return for it.`
			})
		}

		const rawExpected = typeof body.expected === 'string' ? body.expected : ''
		if (rawExpected.length > MAX_EXPECTED_LENGTH) {
			throw createError({
				statusCode: 400,
				statusMessage: 'Expected value is too long.',
				data: { field: 'expected' }
			})
		}
		const expected = normaliseExpected(type, rawExpected)

		// A wildcard answers for names that don't otherwise exist, so ask about a random
		// label under it: that is exactly what a visitor to such a name would get.
		const name = parsed.wildcard
			? parsed.name.replace(/^\*/, `wildcard-check-${randomBytes(4).toString('hex')}`)
			: parsed.name

		// Kick off the public-resolver queries straight away; zone discovery runs alongside.
		const resolverQueries = Promise.all(
			PUBLIC_RESOLVERS.map(async (resolver) => ({
				...resolver,
				...(await queryServer({ ip: resolver.ip, name, type }))
			}))
		)

		const zone = { apex: '', nameservers: [], agree: null, error: '' }
		const { apex, error: apexError } = await findZoneApex(name)
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
				zone.nameservers = await Promise.all(hosts.map((host) => queryNameserver({ host, name, apex, type })))
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

		// "absent" is agreement that nothing exists, which is not the same as a record
		// having propagated.
		let state = 'unknown'
		if (reference && matched + stale > 0) {
			if (stale === 0) state = reference.values.length ? 'propagated' : 'absent'
			else if (matched === 0) state = 'none'
			else state = 'partial'
		}

		return {
			success: true,
			result: {
				input: parsed.original,
				name: parsed.name,
				queriedName: name,
				wildcard: parsed.wildcard,
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
				limits: { queryTimeoutMs: QUERY_TIMEOUT_MS },
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
