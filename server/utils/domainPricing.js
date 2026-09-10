// Indicative registration prices. Porkbun publishes its full TLD price list without
// authentication; it is used here purely as a reference figure next to search results.
// Any failure degrades to "no price shown" rather than breaking the search.

const PRICING_URL = 'https://api.porkbun.com/api/json/v3/pricing/get'
const PRICING_TTL = 6 * 60 * 60 * 1000

const state = globalThis.__domainPricingState || { data: null, promise: null }
if (!globalThis.__domainPricingState) globalThis.__domainPricingState = state

const toAmount = (value) => {
	const number = Number.parseFloat(value)
	return Number.isFinite(number) ? number : null
}

export async function getTldPricing() {
	const now = Date.now()
	if (state.data && state.data.expiresAt > now) return state.data.value
	if (state.promise) return state.promise

	state.promise = (async () => {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), 10000)
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
			return value
		} catch {
			return state.data?.value || null
		} finally {
			clearTimeout(timer)
			state.promise = null
		}
	})()

	return state.promise
}
