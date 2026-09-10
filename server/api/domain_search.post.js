import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { normaliseSearchTerm, normaliseTld, splitDomain } from '../utils/domainNames'
import { dohQuery } from '../utils/doh'
import { rdapDomain } from '../utils/rdap'
import { getTldPricing } from '../utils/domainPricing'

// Availability search. Registry RDAP is the primary signal; a public-resolver NS query
// is the fallback hint for registries without RDAP. Purchase itself happens at the
// registrar, so each result carries deep links rather than an in-app checkout.

const MAX_TLDS = 15
const MAX_CANDIDATES = 16
const CONCURRENCY = 6

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

const checkDomain = async (domain, pricing) => {
	const [rdap, dns] = await Promise.all([
		rdapDomain(domain),
		dohQuery({ resolver: 'cloudflare', name: domain, type: 'NS' }).catch(() => ({ ok: false }))
	])
	const { tld } = splitDomain(domain)
	const price = pricing?.byTld?.[tld] || null
	return {
		domain,
		tld,
		...classify({ rdap, dns }),
		rdapSupported: Boolean(rdap.supported),
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
		price:
			price && price.registration !== null
				? { ...price, currency: pricing.currency, source: pricing.source }
				: null,
		links: buildLinks(domain)
	}
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

		const term = normaliseSearchTerm(body.query)
		if (term.error) throw createError({ statusCode: 400, statusMessage: term.error })

		const tlds = [...new Set((Array.isArray(body.tlds) ? body.tlds : []).map(normaliseTld).filter(Boolean))].slice(
			0,
			MAX_TLDS
		)

		// Registries only know registrable names, so a subdomain is reduced to its parent
		// (shop.example.com → example.com) before anything is checked.
		const baseLabel = term.base.split('.').pop()
		const reducedFrom = baseLabel === term.base ? '' : term.name
		const exact = term.tld ? `${baseLabel}.${term.tld}` : ''
		const candidates = []
		if (exact) candidates.push(exact)
		for (const tld of tlds) {
			const candidate = `${baseLabel}.${tld}`
			if (!candidates.includes(candidate)) candidates.push(candidate)
		}
		if (!candidates.length) {
			throw createError({
				statusCode: 400,
				statusMessage: 'Add a domain ending or choose at least one to check.'
			})
		}

		const pricing = await getTldPricing()
		const results = await runWithConcurrency(candidates.slice(0, MAX_CANDIDATES), (domain) =>
			checkDomain(domain, pricing)
		)

		return {
			success: true,
			result: {
				query: term.original,
				base: baseLabel,
				exact,
				reducedFrom,
				results,
				truncated: candidates.length > MAX_CANDIDATES,
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
			statusMessage: `Domain search failed: ${error?.message || 'Unknown error'}`
		})
	}
})
