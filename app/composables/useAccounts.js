const TTL_MS = 60_000
let pending = null
// Bumped by every request, so only the newest one updates the list.
let latest = 0

const emptyState = (key = '') => ({ key, items: [], fetchedAt: 0, loading: false, error: '' })

// The accounts the token can use, for pickers on pages that act on a whole account rather
// than a zone. Fetched once and shared. load() never throws; failures land in `error`.
//
// Tokens scoped to zones often can't list accounts at all, yet every zone names the account
// that owns it, so those accounts are included too. `error` is only set when neither source
// found an account.
export function useAccounts() {
	const state = useState('cf-accounts', () => emptyState())
	const { getSessionKey } = useSession()
	const { call } = useCfApi()
	const { isFresh } = useDataChanges()
	const { zones, load: loadZones, error: zonesError } = useZones()

	const load = async ({ force = false } = {}) => {
		const key = getSessionKey()
		if (!key) return []
		if (state.value.key !== key) {
			state.value = emptyState(key)
			pending = null
		}
		const fresh = isFresh(state.value.fetchedAt, TTL_MS)
		if (!force && fresh) return accounts.value
		// A reload always asks again, rather than waiting on a request that may never finish.
		if (pending && !force) return pending

		// A response that arrives after a token change, or after a newer request, is dropped.
		const id = ++latest
		const isCurrent = () => state.value?.key === key && id === latest

		state.value.loading = true
		state.value.error = ''
		const request = Promise.all([
			call('accounts', { fresh: force }, { fallback: 'Cloudflare rejected the accounts request' })
				.then((response) => {
					if (!isCurrent()) return
					state.value.items = (response?.result || []).filter((account) => account?.id)
				})
				.catch((error) => {
					if (isCurrent()) state.value.error = describeError(error, 'Couldn’t load accounts')
				}),
			loadZones({ force })
		]).then(() => {
			if (isCurrent()) {
				state.value.fetchedAt = Date.now()
				state.value.loading = false
			}
			if (pending === request) pending = null
			return accounts.value
		})
		pending = request
		return request
	}

	// Listed accounts first, then any account a zone belongs to that the list didn't include.
	const accounts = computed(() => {
		const byId = new Map((state.value?.items || []).map((account) => [account.id, account]))
		for (const zone of zones.value) {
			const owner = zone?.account
			if (owner?.id && !byId.has(owner.id)) byId.set(owner.id, { id: owner.id, name: owner.name || '' })
		}
		return [...byId.values()].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
	})

	return {
		accounts,
		loading: computed(() => Boolean(state.value?.loading)),
		error: computed(() => (accounts.value.length ? '' : state.value?.error || zonesError.value || '')),
		loaded: computed(() => Boolean(state.value?.fetchedAt)),
		load,
		findAccount: (id) => (id ? accounts.value.find((account) => account.id === id) || null : null)
	}
}
