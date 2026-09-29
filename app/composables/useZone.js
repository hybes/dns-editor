import { allows } from '#shared/utils/access'

const DETAIL_TTL_MS = 30_000
const pending = new Map()

// Details and feature access for one zone, shared between the sidebar and the zone's
// pages. The name falls back to the zones list so headings render before details load.
// load() never throws; failures land in `error`.
export function useZone(zoneIdSource) {
	const zoneId = computed(() => String(toValue(zoneIdSource) || ''))
	const cache = useState('cf-zone-details', () => ({}))
	const { call } = useCfApi()
	const { getSessionKey } = useSession()
	const { findZone } = useZones()
	const capabilitiesApi = useCapabilities()
	const { isFresh } = useDataChanges()

	const entry = computed(() => cache.value?.[zoneId.value] || null)
	const zone = computed(() => entry.value?.data || findZone(zoneId.value))
	const zoneName = computed(() => zone.value?.name || '')
	const capabilities = computed(() => capabilitiesApi.state.value?.zones?.[zoneId.value] || null)
	const access = computed(() => capabilitiesApi.state.value?.access?.[zoneId.value] || { shared: false })

	const load = async ({ force = false } = {}) => {
		const id = zoneId.value
		const key = getSessionKey()
		if (!id || !key) return null

		const current = cache.value[id]
		if (!force && current?.data && isFresh(current.fetchedAt, DETAIL_TTL_MS)) {
			// Cached details can outlive a capability check that failed. Retry it here, and
			// wait, so callers that await load() see the new result rather than the failure.
			if (!capabilitiesApi.state.value.zones[id]) await capabilitiesApi.loadZone(key, id).catch(() => null)
			return current.data
		}

		// Keyed by token as well, so a request started before a token change is never reused,
		// and its answer is dropped instead of landing in the new session.
		const pendingKey = `${key}:${id}`
		if (pending.has(pendingKey)) return pending.get(pendingKey)
		const isCurrent = () => getSessionKey() === key && Boolean(cache.value)

		cache.value[id] = { ...current, loading: true, error: '' }
		const request = Promise.all([
			call('zone', { currZone: id, fresh: force }, { fallback: 'Couldn’t load this zone' }),
			capabilitiesApi.loadZone(key, id, { force }).catch(() => null)
		])
			.then(([response]) => {
				if (!isCurrent()) return null
				cache.value[id] = { data: response.result, fetchedAt: Date.now(), loading: false, error: '' }
				localStorage.setItem(STORAGE_KEYS.zoneId, id)
				return response.result
			})
			.catch((error) => {
				if (!isCurrent()) return null
				cache.value[id] = {
					...cache.value[id],
					loading: false,
					error: describeError(error, 'Couldn’t load this zone')
				}
				return null
			})
			.finally(() => pending.delete(pendingKey))

		pending.set(pendingKey, request)
		return request
	}

	return {
		zoneId,
		zone,
		zoneName,
		accountId: computed(() => zone.value?.account?.id || ''),
		loading: computed(() => Boolean(entry.value?.loading)),
		error: computed(() => entry.value?.error || ''),
		capabilities,
		capabilitiesLoaded: computed(() => zoneId.value in (capabilitiesApi.state.value?.zones || {})),
		missingCapabilities: computed(() => capabilitiesApi.missing(capabilities.value)),
		can: (key) => capabilitiesApi.can(capabilities.value, key),
		// For a zone shared with this account: { shared: true, owner, levels, showPrices }. Your own
		// zones are { shared: false }, and every action is allowed.
		access,
		// Whether this account may do `action` (view, edit or delete) in `area` on the zone; see
		// shared/utils/access.js. The server checks the same, so this only hides what would fail.
		allowed: (area, action = 'view') => !access.value.shared || allows(access.value.levels?.[area], action),
		load,
		refresh: () => load({ force: true })
	}
}
