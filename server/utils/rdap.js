// Registration Data Access Protocol lookups: the registry-backed replacement for WHOIS.
// A 404 from the registry's RDAP server is the strongest public signal that a name is
// unregistered; a 200 carries the registrar, dates and status of a registered name.

const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json'
const BOOTSTRAP_TTL = 24 * 60 * 60 * 1000
const RESULT_TTL = 5 * 60 * 1000
const MAX_RESULT_ENTRIES = 500

// Registries that publish RDAP but are absent from the IANA bootstrap file.
// Each was checked by hand against a known registered name.
const EXTRA_SERVERS = {
	io: 'https://rdap.identitydigital.services/rdap/',
	de: 'https://rdap.denic.de/',
	us: 'https://rdap.nic.us/',
	ch: 'https://rdap.nic.ch/'
}

const state = globalThis.__rdapState || { bootstrap: null, bootstrapPromise: null, results: new Map() }
if (!globalThis.__rdapState) globalThis.__rdapState = state

const fetchWithTimeout = async (url, { timeoutMs = 8000, headers = {} } = {}) => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		return await fetch(url, { headers, signal: controller.signal, redirect: 'follow' })
	} finally {
		clearTimeout(timer)
	}
}

const loadBootstrap = async () => {
	const now = Date.now()
	if (state.bootstrap && state.bootstrap.expiresAt > now) return state.bootstrap.map
	if (state.bootstrapPromise) return state.bootstrapPromise

	state.bootstrapPromise = (async () => {
		try {
			const response = await fetchWithTimeout(BOOTSTRAP_URL, { timeoutMs: 10000 })
			if (!response.ok) throw new Error(`IANA bootstrap returned HTTP ${response.status}`)
			const data = await response.json()
			const map = new Map()
			for (const [tlds, urls] of data?.services || []) {
				const url = urls.find((u) => u.startsWith('https://')) || urls[0]
				if (!url) continue
				for (const tld of tlds) map.set(String(tld).toLowerCase(), url.endsWith('/') ? url : `${url}/`)
			}
			state.bootstrap = { map, expiresAt: Date.now() + BOOTSTRAP_TTL }
			return map
		} catch (error) {
			// Keep serving a stale copy rather than failing every search while IANA is unreachable.
			if (state.bootstrap?.map) return state.bootstrap.map
			throw error
		} finally {
			state.bootstrapPromise = null
		}
	})()

	return state.bootstrapPromise
}

// Resolve the RDAP base URL for a name; multi-part endings like co.uk bootstrap on "uk".
export async function getRdapServer(domain) {
	const tld = domain.split('.').pop()
	if (EXTRA_SERVERS[tld]) return EXTRA_SERVERS[tld]
	const map = await loadBootstrap()
	return map.get(tld) || ''
}

const vcardName = (entity) => {
	const cards = Array.isArray(entity?.vcardArray?.[1]) ? entity.vcardArray[1] : []
	const fn = cards.find((item) => Array.isArray(item) && item[0] === 'fn')
	return typeof fn?.[3] === 'string' ? fn[3].trim() : ''
}

const findEvent = (events, action) => {
	const match = (Array.isArray(events) ? events : []).find((e) => e?.eventAction === action)
	return typeof match?.eventDate === 'string' ? match.eventDate : ''
}

const parseRegistered = (data) => {
	const entities = Array.isArray(data.entities) ? data.entities : []
	const registrarEntity = entities.find((e) => Array.isArray(e?.roles) && e.roles.includes('registrar'))
	return {
		available: false,
		registrar: registrarEntity ? vcardName(registrarEntity) : '',
		registered: findEvent(data.events, 'registration'),
		expires: findEvent(data.events, 'expiration'),
		updated: findEvent(data.events, 'last changed'),
		status: Array.isArray(data.status) ? data.status.map(String) : [],
		nameservers: (Array.isArray(data.nameservers) ? data.nameservers : [])
			.map((ns) => (typeof ns?.ldhName === 'string' ? ns.ldhName.toLowerCase() : ''))
			.filter(Boolean)
	}
}

const sweepResults = () => {
	const now = Date.now()
	for (const [key, entry] of state.results) {
		if (entry.expiresAt <= now) state.results.delete(key)
	}
	if (state.results.size <= MAX_RESULT_ENTRIES) return
	for (const key of state.results.keys()) {
		state.results.delete(key)
		if (state.results.size <= MAX_RESULT_ENTRIES) break
	}
}

// Returns { supported, available: true | false | null, reason, ...registration details }.
export async function rdapDomain(domain) {
	const cached = state.results.get(domain)
	if (cached && cached.expiresAt > Date.now()) return { ...cached.value }

	const result = await lookup(domain)
	// Rate-limit and transport failures are not worth remembering.
	if (result.available !== null || !result.supported) {
		state.results.set(domain, { value: result, expiresAt: Date.now() + RESULT_TTL })
		sweepResults()
	}
	return { ...result }
}

const lookup = async (domain) => {
	let server
	try {
		server = await getRdapServer(domain)
	} catch (error) {
		return { supported: false, available: null, reason: error?.message || 'Could not load the RDAP directory' }
	}
	if (!server) {
		return {
			supported: false,
			available: null,
			reason: `The .${domain.split('.').pop()} registry does not publish RDAP`
		}
	}

	try {
		const response = await fetchWithTimeout(`${server}domain/${encodeURIComponent(domain)}`, {
			headers: { accept: 'application/rdap+json, application/json' }
		})

		if (response.status === 404) return { supported: true, available: true }
		if (response.status === 429) {
			return {
				supported: true,
				available: null,
				reason: 'The registry rate-limited this lookup; try again shortly'
			}
		}
		if (!response.ok) {
			return { supported: true, available: null, reason: `The registry responded with HTTP ${response.status}` }
		}

		const data = await response.json()
		if (data?.errorCode === 404) return { supported: true, available: true }
		if (data?.errorCode) {
			return { supported: true, available: null, reason: data.title || `Registry error ${data.errorCode}` }
		}
		return { supported: true, ...parseRegistered(data) }
	} catch (error) {
		const message = error?.name === 'AbortError' ? 'The registry did not respond in time' : error?.message
		return { supported: true, available: null, reason: message || 'RDAP lookup failed' }
	}
}
