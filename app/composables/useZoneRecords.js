const TTL_MS = 30_000

// Per zone: the request in flight, the token of the newest load, and a count of local
// edits. A load may only write if it is still the newest and nothing was edited while it
// ran; otherwise its answer predates a save, delete or proxy change and would undo it.
const pending = new Map()
const latest = new Map()
const edits = new Map()
let sequence = 0

// One zone's DNS records, shared by the records table and the create/edit panel so a
// save updates the table in place instead of refetching the whole zone.
// load() never throws; failures land in `error`. refresh() asks the server to skip its
// short-lived cache so a retry really goes back to Cloudflare.
export function useZoneRecords(zoneIdSource) {
	const zoneId = computed(() => String(toValue(zoneIdSource) || ''))
	const cache = useState('cf-zone-records', () => ({}))
	const { call } = useCfApi()
	const { getApiKey } = useSession()

	const entry = computed(() => cache.value?.[zoneId.value] || null)

	const load = async ({ force = false } = {}) => {
		const id = zoneId.value
		const key = getApiKey()
		if (!id || !key) return []

		const current = cache.value[id]
		if (!force && current?.fetchedAt && Date.now() - current.fetchedAt < TTL_MS) return current.items

		const editCount = edits.get(id) || 0
		const inFlight = pending.get(id)
		if (!force && inFlight && inFlight.key === key && inFlight.editCount === editCount) return inFlight.request

		const token = ++sequence
		latest.set(id, token)
		cache.value[id] = {
			items: current?.items || [],
			fetchedAt: current?.fetchedAt || 0,
			partial: Boolean(current?.partial),
			partialMessage: current?.partialMessage || '',
			loading: true,
			error: ''
		}

		const isNewest = () => latest.get(id) === token && getApiKey() === key && Boolean(cache.value?.[id])
		let outdated = false

		const request = call('records', { currZone: id, fresh: force }, { fallback: 'Couldn’t load DNS records' })
			.then((response) => {
				if (!isNewest()) return
				if ((edits.get(id) || 0) !== editCount) {
					outdated = true
					return
				}
				const partial = Boolean(response?.partial)
				cache.value[id] = {
					items: response?.result || [],
					fetchedAt: Date.now(),
					partial,
					partialMessage: partial ? response?.message || '' : '',
					loading: false,
					error: ''
				}
			})
			.catch((error) => {
				if (!isNewest()) return
				cache.value[id] = {
					...cache.value[id],
					loading: false,
					error: describeError(error, 'Couldn’t load DNS records')
				}
			})
			.finally(() => {
				if (pending.get(id)?.token === token) pending.delete(id)
			})
			// Runs after the pending entry is gone, so the follow-up is a genuinely new request.
			.then(() => (outdated ? load({ force: true }) : cache.value?.[id]?.items || []))

		pending.set(id, { request, token, key, editCount })
		return request
	}

	const markEdited = (id) => edits.set(id, (edits.get(id) || 0) + 1)

	// Apply a record returned by a create or update without a round trip.
	const upsert = (record) => {
		const id = zoneId.value
		if (!id || !record?.id || !cache.value?.[id]) return
		markEdited(id)
		const items = cache.value[id].items
		const index = items.findIndex((item) => item.id === record.id)
		cache.value[id].items =
			index === -1 ? [...items, record] : items.map((item, i) => (i === index ? record : item))
	}

	const remove = (recordIds) => {
		const id = zoneId.value
		if (!id || !cache.value?.[id]) return
		markEdited(id)
		const drop = new Set(Array.isArray(recordIds) ? recordIds : [recordIds])
		cache.value[id].items = cache.value[id].items.filter((item) => !drop.has(item.id))
	}

	return {
		zoneId,
		records: computed(() => entry.value?.items || []),
		loading: computed(() => Boolean(entry.value?.loading)),
		loaded: computed(() => Boolean(entry.value?.fetchedAt)),
		partial: computed(() => Boolean(entry.value?.partial)),
		partialMessage: computed(() => entry.value?.partialMessage || ''),
		error: computed(() => entry.value?.error || ''),
		findRecord: (recordId) => entry.value?.items.find((item) => item.id === recordId) || null,
		load,
		refresh: () => load({ force: true }),
		upsert,
		remove
	}
}
