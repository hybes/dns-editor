import { getTldPricing } from '../utils/domainPricing'

// Every domain ending in the reference price list, with its first-year and renewal prices, for
// Domain Search's ending picker. Needs no token. When the price list can't be reached the list
// is empty and the page keeps its own endings.
export default defineEventHandler(async () => {
	const pricing = await getTldPricing()
	if (!pricing) return { success: true, result: { endings: [], currency: '', source: '' } }

	const endings = Object.entries(pricing.byTld)
		.filter(([, price]) => price.registration !== null)
		.map(([tld, price]) => ({ tld, registration: price.registration, renewal: price.renewal }))
		.sort((a, b) => a.tld.localeCompare(b.tld))

	return { success: true, result: { endings, currency: pricing.currency, source: pricing.source } }
})
