const TTL_MS = 60_000
let pending = null

const emptyState = (key = '') => ({ key, items: [], fetchedAt: 0, loading: false, error: '' })

// The token's zone list, shared by the sidebar switcher, the command palette and the
// zones page, so it is fetched once rather than by every component that shows zones.
// load() never throws; failures land in `error` for the caller to display.
export function useZones() {
	const state = useState('cf-zones', () => emptyState())
	const { getApiKey } = useSession()
	const { call } = useCfApi()

	const load = async ({ force = false } = {}) => {
		const key = getApiKey()
		if (!key) return []
		if (state.value.key !== key) {
			state.value = emptyState(key)
			pending = null
		}
		const fresh = state.value.fetchedAt && Date.now() - state.value.fetchedAt < TTL_MS
		if (!force && fresh) return state.value.items
		if (pending) return pending

		// A response that arrives after a token change belongs to the old session; drop it.
		const isCurrent = () => state.value?.key === key

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
