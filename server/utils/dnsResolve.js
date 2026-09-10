import { Resolver } from 'node:dns/promises'

// Plain DNS (port 53) client on Node's c-ares resolver, so any recursive or
// authoritative server can be asked directly. The propagation checker needs exactly
// that: the same question put to many caches and to the zone's own nameservers.

export const PROPAGATION_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA', 'PTR']

// Public recursive resolvers that answered reliably when this list was assembled.
// "region" is where the operator is based or whom the service is aimed at; the big
// providers answer from anycast nodes near wherever this server runs.
export const PUBLIC_RESOLVERS = [
	{ id: 'cloudflare', label: 'Cloudflare', ip: '1.1.1.1', region: 'Global anycast' },
	{ id: 'google', label: 'Google', ip: '8.8.8.8', region: 'Global anycast' },
	{ id: 'quad9', label: 'Quad9', ip: '9.9.9.9', region: 'Global anycast' },
	{ id: 'opendns', label: 'OpenDNS', ip: '208.67.222.222', region: 'Global anycast' },
	{ id: 'adguard', label: 'AdGuard', ip: '94.140.14.14', region: 'Global anycast' },
	{ id: 'cleanbrowsing', label: 'CleanBrowsing', ip: '185.228.168.9', region: 'Global anycast' },
	{ id: 'controld', label: 'Control D', ip: '76.76.2.0', region: 'Global anycast' },
	{ id: 'nextdns', label: 'NextDNS', ip: '45.90.28.0', region: 'Global anycast' },
	{ id: 'ultradns', label: 'UltraDNS', ip: '64.6.64.6', region: 'Global anycast' },
	{ id: 'comodo', label: 'Comodo Secure', ip: '8.26.56.26', region: 'Global anycast' },
	{ id: 'he', label: 'Hurricane Electric', ip: '74.82.42.42', region: 'United States' },
	{ id: 'cira', label: 'CIRA Canadian Shield', ip: '149.112.121.10', region: 'Canada' },
	{ id: 'yandex', label: 'Yandex', ip: '77.88.8.8', region: 'Russia' },
	{ id: 'alidns', label: 'AliDNS', ip: '223.5.5.5', region: 'China' },
	{ id: 'dnspod', label: 'DNSPod', ip: '119.29.29.29', region: 'China' }
]

const STATUS_BY_CODE = {
	ENOTFOUND: 'nxdomain',
	ENODATA: 'nodata',
	ETIMEOUT: 'timeout',
	ESERVFAIL: 'servfail',
	EREFUSED: 'refused',
	ECONNREFUSED: 'refused',
	ECANCELLED: 'error'
}

// Statuses that are a definite "this name/type has nothing" rather than a transport failure.
export const EMPTY_STATUSES = new Set(['nodata', 'nxdomain'])

const trimDot = (value) =>
	String(value || '')
		.replace(/\.$/, '')
		.toLowerCase()

const CAA_TAGS = ['issue', 'issuewild', 'iodef', 'contactemail', 'contactphone']

// Turn a c-ares answer into comparable strings, one per record.
export const normaliseAnswer = (type, answer) => {
	switch (type) {
		case 'A':
		case 'AAAA':
			return answer.map((r) => (typeof r === 'string' ? r : r.address).toLowerCase())
		case 'CNAME':
		case 'NS':
		case 'PTR':
			return answer.map(trimDot)
		case 'MX':
			return answer.map((r) => `${r.priority} ${trimDot(r.exchange)}`)
		case 'TXT':
			return answer.map((chunks) => (Array.isArray(chunks) ? chunks.join('') : String(chunks)))
		case 'SRV':
			return answer.map((r) => `${r.priority} ${r.weight} ${r.port} ${trimDot(r.name)}`)
		case 'CAA':
			return answer.map((r) => {
				const tag = CAA_TAGS.find((t) => r[t] !== undefined) || 'issue'
				return `${r.critical || 0} ${tag} ${r[tag] ?? ''}`
			})
		case 'SOA':
			return [
				`${trimDot(answer.nsname)} ${trimDot(answer.hostmaster)} ${answer.serial} ${answer.refresh} ${answer.retry} ${answer.expire} ${answer.minttl}`
			]
		default:
			return []
	}
}

// Normalise a value typed by a person (or copied from a Cloudflare record) the same way,
// so "mail.example.com." and "10 MAIL.example.com" compare equal to what resolvers return.
export const normaliseExpected = (type, value) => {
	const v = String(value ?? '')
		.trim()
		.replace(/\s+/g, ' ')
	if (!v) return ''
	const unquote = (s) => s.replace(/^"(.*)"$/s, '$1')
	switch (type) {
		case 'A':
		case 'AAAA':
			return v.toLowerCase()
		case 'CNAME':
		case 'NS':
		case 'PTR':
			return trimDot(v)
		case 'TXT':
			return unquote(v).replace(/" "/g, '')
		case 'MX': {
			const [priority, host] = v.split(' ')
			return host ? `${priority} ${trimDot(host)}` : trimDot(v)
		}
		case 'SRV': {
			const parts = v.split(' ')
			return parts.length === 4 ? `${parts[0]} ${parts[1]} ${parts[2]} ${trimDot(parts[3])}` : v.toLowerCase()
		}
		case 'CAA': {
			const parts = v.split(' ')
			return parts.length >= 3 ? `${parts[0]} ${parts[1].toLowerCase()} ${unquote(parts.slice(2).join(' '))}` : v
		}
		default:
			return v
	}
}

// True when a resolver's answer set contains the expected value. A bare hostname is
// accepted for MX/SRV/CAA so "mail.example.com" matches "10 mail.example.com".
export const containsExpected = (values, expected) =>
	values.includes(expected) || values.some((v) => v.includes(' ') && v.split(' ').pop() === expected)

export const sameValues = (a, b) => a.length === b.length && a.every((value, index) => value === b[index])

// Ask one server for one record set. Never throws: transport and lookup failures
// come back as a status so callers can tabulate them.
export async function queryServer({ ip, name, type, timeoutMs = 4000 }) {
	const resolver = new Resolver({ timeout: timeoutMs, tries: 1 })
	resolver.setServers([ip])
	const startedAt = Date.now()
	try {
		let answer
		let ttl = null
		if (type === 'A' || type === 'AAAA') {
			const records =
				type === 'A'
					? await resolver.resolve4(name, { ttl: true })
					: await resolver.resolve6(name, { ttl: true })
			ttl = records.length ? Math.min(...records.map((r) => r.ttl)) : null
			answer = records
		} else {
			answer = await resolver.resolve(name, type)
		}
		return {
			ok: true,
			status: 'ok',
			values: normaliseAnswer(type, answer).sort(),
			ttl,
			durationMs: Date.now() - startedAt
		}
	} catch (error) {
		return {
			ok: false,
			status: STATUS_BY_CODE[error?.code] || 'error',
			values: [],
			ttl: null,
			durationMs: Date.now() - startedAt,
			error: error?.code || error?.message || 'Query failed'
		}
	}
}

export const soaSerial = (values) => {
	const serial = values?.[0]?.split(' ')[2]
	return serial && /^\d+$/.test(serial) ? Number(serial) : null
}
