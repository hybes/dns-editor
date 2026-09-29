const TTL_MS = 5 * 60_000

// Shared by every caller, so the page and anything else asking at once make one request.
let request = null

const emptyState = (key = '') => ({
	key,
	byDomain: {},
	prices: {},
	fetchedAt: 0,
	loading: false,
	denied: false,
	error: ''
})

// Renewal dates, auto-renew and renewal prices for the Zones list, from /api/renewals (see
// server/utils/renewals.js): the account's own Cloudflare Registrar domains, and the domains
// shared with it where the owner gave renewal access. Prices are the domain's own quote, or
// Cloudflare's current price for a standard name on the same ending (`standard: true`), or, for
// a shared domain, the price the owner set (`custom: true`). Loads once per session and again
// after TTL_MS. load() never throws.
export function useRegistrations() {
	const state = useState('cf-registrations', () => emptyState())
	const { getSessionKey } = useSession()
	const { call } = useCfApi()

	const load = async ({ force = false } = {}) => {
		const key = getSessionKey()
		if (!key) return
		if (state.value.key !== key) {
			state.value = emptyState(key)
			request = null
		}
		if (!force && state.value.fetchedAt && Date.now() - state.value.fetchedAt < TTL_MS) return
		if (request && !force) return request

		const isCurrent = () => state.value.key === key
		state.value.loading = true
		state.value.error = ''
		const current = call('renewals', { fresh: force }, { fallback: 'Cloudflare didn’t return the renewals' })
			.then((response) => {
				if (!isCurrent()) return
				const result = response?.result || {}
				state.value.byDomain = result.registrations || {}
				state.value.prices = result.prices || {}
				state.value.denied = Boolean(result.denied)
				state.value.fetchedAt = Date.now()
			})
			.catch((error) => {
				if (isCurrent()) state.value.error = describeError(error, 'Couldn’t load renewal dates')
			})
			.finally(() => {
				if (isCurrent()) state.value.loading = false
				if (request === current) request = null
			})
		request = current
		return current
	}

	// The registration after an auto-renew change.
	const update = (registration) => {
		const domain = registration?.domain_name?.toLowerCase()
		if (domain && state.value.byDomain[domain]) {
			state.value.byDomain[domain] = { ...state.value.byDomain[domain], ...registration }
		}
	}

	return {
		registrationFor: (domain) => state.value.byDomain[String(domain || '').toLowerCase()] || null,
		priceFor: (domain) => state.value.prices[String(domain || '').toLowerCase()] || null,
		loading: computed(() => state.value.loading),
		loaded: computed(() => Boolean(state.value.fetchedAt)),
		denied: computed(() => state.value.denied),
		error: computed(() => state.value.error),
		load,
		update
	}
}
