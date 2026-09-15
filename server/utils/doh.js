import { LOOKUP_RECORD_TYPES } from '#shared/utils/dnsTypes'

// DNS-over-HTTPS (JSON) queries against public resolvers. Used by the DNS lookup tool
// and, as a registration hint, by the domain search tool. No Cloudflare token is
// involved: the only thing sent upstream is the name being queried.

// Fanned out when the caller asks for "all common" records.
export const COMMON_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA']

const TYPE_NUMBERS = {
	A: 1,
	NS: 2,
	CNAME: 5,
	SOA: 6,
	PTR: 12,
	HINFO: 13,
	MX: 15,
	TXT: 16,
	AAAA: 28,
	SRV: 33,
	NAPTR: 35,
	DS: 43,
	RRSIG: 46,
	NSEC: 47,
	DNSKEY: 48,
	NSEC3: 50,
	TLSA: 52,
	SVCB: 64,
	HTTPS: 65,
	CAA: 257
}

const NUMBER_TYPES = Object.fromEntries(Object.entries(TYPE_NUMBERS).map(([name, code]) => [code, name]))

const RCODES = {
	0: 'NOERROR',
	1: 'FORMERR',
	2: 'SERVFAIL',
	3: 'NXDOMAIN',
	4: 'NOTIMP',
	5: 'REFUSED'
}

export const RESOLVERS = {
	cloudflare: {
		id: 'cloudflare',
		label: 'Cloudflare',
		address: '1.1.1.1',
		url: (name, type) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
		headers: { accept: 'application/dns-json' }
	},
	google: {
		id: 'google',
		label: 'Google',
		address: '8.8.8.8',
		url: (name, type) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
		headers: { accept: 'application/json' }
	}
}

export const RESOLVER_IDS = Object.keys(RESOLVERS)

const trimDot = (value) => String(value || '').replace(/\.$/, '')

const mapRecords = (list) =>
	(Array.isArray(list) ? list : []).map((record) => ({
		name: trimDot(record.name).toLowerCase(),
		type: NUMBER_TYPES[record.type] || `TYPE${record.type}`,
		ttl: Number.isFinite(record.TTL) ? record.TTL : null,
		data: typeof record.data === 'string' ? record.data : JSON.stringify(record.data ?? '')
	}))

export async function dohQuery({ resolver = 'cloudflare', name, type = 'A', timeoutMs = 8000 }) {
	const config = RESOLVERS[resolver]
	if (!config) throw new Error(`Unknown resolver: ${resolver}`)
	if (!LOOKUP_RECORD_TYPES.includes(type)) throw new Error(`Unsupported record type: ${type}`)

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	const startedAt = Date.now()

	try {
		const response = await fetch(config.url(name, type), {
			headers: config.headers,
			signal: controller.signal
		})
		if (!response.ok) {
			return {
				ok: false,
				error: `${config.label} responded with HTTP ${response.status}`,
				durationMs: Date.now() - startedAt
			}
		}
		const data = await response.json()
		return {
			ok: true,
			status: RCODES[data.Status] || `RCODE ${data.Status}`,
			statusCode: data.Status,
			dnssec: Boolean(data.AD),
			truncated: Boolean(data.TC),
			answers: mapRecords(data.Answer),
			authority: mapRecords(data.Authority),
			comment: typeof data.Comment === 'string' ? data.Comment : '',
			durationMs: Date.now() - startedAt
		}
	} catch (error) {
		const message = error?.name === 'AbortError' ? `${config.label} did not respond in time` : error?.message
		return { ok: false, error: message || 'Lookup failed', durationMs: Date.now() - startedAt }
	} finally {
		clearTimeout(timer)
	}
}
