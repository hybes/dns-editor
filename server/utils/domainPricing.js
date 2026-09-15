// Indicative registration prices. Porkbun publishes its full TLD price list without
// authentication; it is used here purely as a reference figure next to search results.
// Any failure degrades to "no price shown" rather than breaking the search.

const PRICING_URL = 'https://api.porkbun.com/api/json/v3/pricing/get'
const PRICING_TTL = 6 * 60 * 60 * 1000
// Porkbun's full price list can take around ten seconds. Searches stop waiting after a short
// grace period (domain_search.post.js), so a slow fetch finishes in the background instead.
const REQUEST_TIMEOUT_MS = 20000
// Self-hosted servers with restricted egress often can't reach Porkbun at all. Remembering
// the failure means that costs one timeout every few minutes instead of one per search.
const FAILURE_TTL = 10 * 60 * 1000

const state = globalThis.__domainPricingState || { data: null, promise: null, failedUntil: 0 }
if (!globalThis.__domainPricingState) globalThis.__domainPricingState = state

const toAmount = (value) => {
	const number = Number.parseFloat(value)
	return Number.isFinite(number) ? number : null
}

// Never rejects: resolves to the price list, a stale copy of it, or null.
export async function getTldPricing() {
	const now = Date.now()
	if (state.data && state.data.expiresAt > now) return state.data.value
	if ((state.failedUntil || 0) > now) return state.data?.value || null
	if (state.promise) return state.promise

	state.promise = (async () => {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
		try {
			const response = await fetch(PRICING_URL, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
				signal: controller.signal
			})
			if (!response.ok) throw new Error(`Pricing endpoint returned HTTP ${response.status}`)
			const data = await response.json()
			if (data?.status !== 'SUCCESS' || typeof data.pricing !== 'object')
				throw new Error('Unexpected pricing payload')

			const byTld = {}
			for (const [tld, entry] of Object.entries(data.pricing)) {
				byTld[tld.toLowerCase()] = {
					registration: toAmount(entry?.registration),
					renewal: toAmount(entry?.renewal)
				}
			}
			const value = { source: 'Porkbun', currency: 'USD', fetchedAt: new Date().toISOString(), byTld }
			state.data = { value, expiresAt: Date.now() + PRICING_TTL }
			state.failedUntil = 0
			return value
		} catch {
			state.failedUntil = Date.now() + FAILURE_TTL
			return state.data?.value || null
		} finally {
			clearTimeout(timer)
			state.promise = null
		}
	})()

	return state.promise
}
