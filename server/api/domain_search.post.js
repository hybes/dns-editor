import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { normaliseSearchTerm, normaliseTld, splitDomain } from '../utils/domainNames'
import { dohQuery } from '../utils/doh'
import { rdapDomain } from '../utils/rdap'
import { getTldPricing } from '../utils/domainPricing'

// Availability search. Registry RDAP is the primary signal; a public-resolver NS query
// is the fallback hint for registries without RDAP. Purchase itself happens at the
// registrar, so each result carries deep links rather than an in-app checkout.

const MAX_TLDS = 30
// Several names can be compared at once, each across the chosen endings. The total is capped
// so one search can't turn into hundreds of registry queries.
const MAX_NAMES = 30
const MAX_CANDIDATES = 60
const CONCURRENCY = 6
// How long prices may lag behind the registry checks before results go out without them.
const PRICING_GRACE_MS = 1500

// Cloudflare's register page has no search parameter, so the name must be pasted there.
const CLOUDFLARE_REGISTER_URL = 'https://dash.cloudflare.com/?to=/:account/registrar/register'

const buildLinks = (domain) => ({
	cloudflare: CLOUDFLARE_REGISTER_URL,
	porkbun: `https://porkbun.com/checkout/search?q=${encodeURIComponent(domain)}`,
	namecheap: `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(domain)}`
})

const classify = ({ rdap, dns }) => {
	if (rdap.available === true) {
		return { availability: 'available', source: 'registry', reason: 'The registry has no record of this name.' }
	}
	if (rdap.available === false) {
		return { availability: 'registered', source: 'registry', reason: '' }
	}

	const dnsOk = dns?.ok
	if (dnsOk && dns.status === 'NOERROR' && dns.answers.length) {
		return {
			availability: 'registered',
			source: 'dns',
			reason: `${rdap.reason}; the name already has nameservers in DNS.`
		}
	}
	if (dnsOk && dns.status === 'NXDOMAIN') {
		return {
			availability: 'maybe',
			source: 'dns',
			reason: `${rdap.reason}; the name has no DNS records, so it may be free. A registrar will confirm.`
		}
	}
	return { availability: 'unknown', source: null, reason: rdap.reason || 'Could not determine availability.' }
}

const checkDomain = async (domain) => {
	const [rdap, dns] = await Promise.all([
		rdapDomain(domain),
		dohQuery({ resolver: 'cloudflare', name: domain, type: 'NS' }).catch(() => ({ ok: false }))
	])
	const { tld } = splitDomain(domain)
	return {
		domain,
		tld,
		...classify({ rdap, dns }),
		// null when the RDAP directory itself could not be loaded
		rdapSupported: rdap.supported ?? null,
		registrar: rdap.registrar || '',
		registered: rdap.registered || '',
		expires: rdap.expires || '',
		status: rdap.status || [],
		nameservers: rdap.nameservers?.length
			? rdap.nameservers
			: dns?.ok
				? dns.answers.filter((r) => r.type === 'NS').map((r) => r.data.replace(/\.$/, ''))
				: [],
		dnsStatus: dns?.ok ? dns.status : '',
		links: buildLinks(domain)
	}
}

const priceFor = (tld, pricing) => {
	const price = pricing?.byTld?.[tld]
	if (!price || price.registration === null) return null
	return { ...price, currency: pricing.currency, source: pricing.source }
}

// Resolves to the promise's value, or null when it takes longer than ms.
const withinGrace = (promise, ms) => {
	let timer
	const timeout = new Promise((resolve) => {
		timer = setTimeout(() => resolve(null), ms)
	})
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const runWithConcurrency = async (items, worker) => {
	const results = new Array(items.length)
	let next = 0
	const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
		while (next < items.length) {
			const index = next++
			results[index] = await worker(items[index])
		}
	})
	await Promise.all(runners)
	return results
}

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		// `names` is a list; `query` may hold several names separated by commas, semicolons or
		// lines. Spaces inside a name are dropped, so "coffee shop" is checked as coffeeshop.
		const rawNames = Array.isArray(body.names) ? body.names : String(body.query ?? '').split(/[,;\n]+/)
		const names = [...new Set(rawNames.map((name) => String(name).replace(/\s+/g, '')).filter(Boolean))]
		if (!names.length) throw createError({ statusCode: 400, message: 'Enter a name to search for.' })
		if (names.length > MAX_NAMES) {
			throw createError({ statusCode: 400, message: `Compare up to ${MAX_NAMES} names at a time.` })
		}

		const tlds = [...new Set((Array.isArray(body.tlds) ? body.tlds : []).map(normaliseTld).filter(Boolean))]
		if (tlds.length > MAX_TLDS) {
			throw createError({ statusCode: 400, message: `Choose up to ${MAX_TLDS} domain endings at a time.` })
		}

		// Registries only know registrable names, so a subdomain is reduced to its parent
		// (shop.example.com → example.com) before anything is checked.
		const bases = []
		const candidates = []
		const baseOf = new Map()
		for (const name of names) {
			const term = normaliseSearchTerm(name)
			if (term.error) {
				throw createError({
					statusCode: 400,
					message: names.length > 1 ? `${name}: ${term.error}` : term.error
				})
			}
			const baseLabel = term.base.split('.').pop()
			const exact = term.tld ? `${baseLabel}.${term.tld}` : ''
			bases.push({
				query: term.original,
				base: baseLabel,
				exact,
				reducedFrom: baseLabel === term.base ? '' : term.name
			})
			for (const candidate of [exact, ...tlds.map((tld) => `${baseLabel}.${tld}`)].filter(Boolean)) {
				if (baseOf.has(candidate)) continue
				baseOf.set(candidate, baseLabel)
				candidates.push(candidate)
			}
		}
		if (!candidates.length) {
			throw createError({
				statusCode: 400,
				message: 'Add a domain ending or choose at least one to check.'
			})
		}
		if (candidates.length > MAX_CANDIDATES) {
			throw createError({
				statusCode: 400,
				message: `That’s ${candidates.length} names to check, and the most at once is ${MAX_CANDIDATES}. Choose fewer names, variations or endings.`
			})
		}

		// Prices only decorate the results, so the list loads alongside the registry checks and
		// gets a short grace period once they finish. A slower fetch carries on in the
		// background and fills the cache for the next search.
		const pricingPromise = getTldPricing()
		const checked = await runWithConcurrency(candidates, checkDomain)
		const pricing = await withinGrace(pricingPromise, PRICING_GRACE_MS)
		const results = checked.map((item) => ({
			...item,
			base: baseOf.get(item.domain),
			price: priceFor(item.tld, pricing)
		}))

		return {
			success: true,
			result: {
				// The first name's details, as before several names could be searched at once.
				...bases[0],
				bases,
				results,
				pricing: pricing
					? { source: pricing.source, currency: pricing.currency, fetchedAt: pricing.fetchedAt }
					: null,
				checkedAt: new Date().toISOString()
			}
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: `Domain search failed: ${error?.message || 'Unknown error'}`
		})
	}
})
