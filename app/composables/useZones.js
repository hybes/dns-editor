const TTL_MS = 60_000
let pending = null
// Bumped by every request, so only the newest one updates the list.
let latest = 0

const emptyState = (key = '') => ({ key, items: [], fetchedAt: 0, loading: false, error: '' })

// The token's zone list, shared by the sidebar switcher, the command palette and the
// zones page, so it is fetched once rather than by every component that shows zones.
// load() never throws; failures land in `error` for the caller to display.
export function useZones() {
	const state = useState('cf-zones', () => emptyState())
	const { getSessionKey } = useSession()
	const { call } = useCfApi()
	const { isFresh } = useDataChanges()

	const load = async ({ force = false } = {}) => {
		const key = getSessionKey()
		if (!key) return []
		if (state.value.key !== key) {
			state.value = emptyState(key)
			pending = null
		}
		const fresh = isFresh(state.value.fetchedAt, TTL_MS)
		if (!force && fresh) return state.value.items
		// A reload always asks again, rather than waiting on a request that may never finish.
		if (pending && !force) return pending

		// A response that arrives after a token change, or after a newer request, is dropped.
		const id = ++latest
		const isCurrent = () => state.value?.key === key && id === latest

		state.value.loading = true
		state.value.error = ''
		const request = call('zones', { fresh: force }, { fallback: 'Cloudflare rejected the zones request' })
			.then((response) => {
				if (!isCurrent()) return
				state.value.items = (response?.result || [])
					.filter((zone) => zone?.id && zone?.name)
					.sort((a, b) => a.name.localeCompare(b.name))
				state.value.fetchedAt = Date.now()
			})
			.catch((error) => {
				if (isCurrent()) state.value.error = describeError(error, 'Couldn’t load zones')
			})
			.then(() => {
				if (isCurrent()) state.value.loading = false
				if (pending === request) pending = null
				return state.value?.items || []
			})
		pending = request
		return request
	}

	const findZone = (id) => (id ? state.value?.items.find((zone) => zone.id === id) || null : null)

	return {
		zones: computed(() => state.value?.items || []),
		loading: computed(() => Boolean(state.value?.loading)),
		error: computed(() => state.value?.error || ''),
		loaded: computed(() => Boolean(state.value?.fetchedAt)),
		load,
		findZone
	}
}
