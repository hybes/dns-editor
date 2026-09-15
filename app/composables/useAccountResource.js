const TTL_MS = 30_000
// Per resource and zone: the list request in flight, with the token it was sent with.
const pending = new Map()
let sequence = 0

// List, create, update and delete for one kind of account-wide Cloudflare resource (Turnstile
// widgets, DNS views, DNS Firewall clusters) through a pair of /api routes: `list` answers
// list and create, `item` answers update and delete. The routes find the account from the
// zone in the URL, so state is kept per zone and shared by every component on the page.
//
// load() never throws; failures land in `error`. create/update/remove throw (CfApiError or
// FetchError) so the form or modal that started them can show Cloudflare's message, and on
// success they update the list in place instead of refetching it.
//
// Each zone's entry carries a `revision` that every local change bumps. A list response
// only writes if the revision hasn't moved since it was requested; otherwise it predates a
// create, update or delete and is fetched again. Responses sent with a different token
// than the one now saved are dropped.
//
// Options:
//   list        endpoint for list and create, e.g. 'turnstile_widgets'
//   item        endpoint for update and delete, e.g. 'turnstile_widget'
//   payloadKey  body field that carries create/update data, e.g. 'widget'
//   idKey       field that identifies an item in Cloudflare's results (default 'id')
//   idParam     body field the item endpoint expects the ID in (defaults to idKey)
//   label       singular noun for fallback messages, e.g. 'Turnstile widget'
//   perPage     optional; asks for page 1 with this per_page, for lists that support it
//   normalise   optional; maps each item before it is stored, e.g. to drop a secret
export function useAccountResource(
	zoneIdSource,
	{ list, item, payloadKey, idKey = 'id', idParam = idKey, label = 'item', perPage, normalise = (value) => value }
) {
	const zoneId = computed(() => String(toValue(zoneIdSource) || ''))
	const cache = useState(`cf-account-${list}`, () => ({}))
	const { call } = useCfApi()
	const { getApiKey } = useSession()

	const entry = computed(() => cache.value?.[zoneId.value] || null)
	const pendingKey = (id) => `${list}:${id}`

	const loadZone = async (id, { force = false } = {}) => {
		const key = getApiKey()
		if (!id || !key) return []

		const current = cache.value[id]
		if (!force && current?.fetchedAt && Date.now() - current.fetchedAt < TTL_MS) return current.items
		const inFlight = pending.get(pendingKey(id))
		if (inFlight && inFlight.key === key) return inFlight.request

		const token = ++sequence
		const revision = current?.revision || 0
		cache.value[id] = {
			items: current?.items || [],
			resultInfo: current?.resultInfo || null,
			fetchedAt: current?.fetchedAt || 0,
			revision,
			loading: true,
			error: ''
		}

		const body = { currZone: id, fresh: force }
		if (perPage) Object.assign(body, { page: 1, per_page: perPage })
		const fallback = `Couldn’t load ${label}s`
		const isCurrent = () => getApiKey() === key && Boolean(cache.value?.[id])
		let stale = false

		const request = call(list, body, { fallback })
			.then((response) => {
				if (!isCurrent()) return
				// A create, update or delete finished while this was in flight. Leave the
				// list loading and fetch it again below; the mutation cleared the server cache.
				if ((cache.value[id].revision || 0) !== revision) {
					stale = true
					return
				}
				cache.value[id] = {
					items: (response?.result || []).map(normalise),
					resultInfo: response?.result_info || null,
					fetchedAt: Date.now(),
					revision,
					loading: false,
					error: ''
				}
			})
			.catch((error) => {
				if (!isCurrent()) return
				cache.value[id] = { ...cache.value[id], loading: false, error: describeError(error, fallback) }
			})
			.finally(() => {
				if (pending.get(pendingKey(id))?.token === token) pending.delete(pendingKey(id))
			})
			// Runs after the pending entry is gone, so the follow-up is a genuinely new request.
			.then(() => (stale ? loadZone(id, { force: true }) : cache.value?.[id]?.items || []))

		pending.set(pendingKey(id), { request, token, key })
		return request
	}

	const load = (options) => loadZone(zoneId.value, options)

	const changeTotal = (id, delta) => {
		const info = cache.value[id]?.resultInfo
		if (info && typeof info.total_count === 'number') info.total_count = Math.max(0, info.total_count + delta)
	}

	const bumpRevision = (value) => {
		value.revision = (value.revision || 0) + 1
	}

	// Other zones in the same account show the same list, so their copies are now out of
	// date. fetchedAt 1 keeps them counted as loaded but past the TTL, so the next load()
	// refetches; the bumped revision makes a list request already in flight fetch again.
	const markOtherZonesStale = (id) => {
		for (const [key, value] of Object.entries(cache.value || {})) {
			if (key === id || !value) continue
			if (value.fetchedAt) value.fetchedAt = 1
			bumpRevision(value)
		}
	}

	const store = (id, value) => {
		const current = cache.value[id]
		if (!current || !value?.[idKey]) return
		bumpRevision(current)
		const index = current.items.findIndex((existing) => existing[idKey] === value[idKey])
		if (index === -1) {
			current.items = [...current.items, value]
			changeTotal(id, 1)
		} else {
			current.items = current.items.map((existing, i) => (i === index ? value : existing))
		}
	}

	// Resolves to Cloudflare's result before normalise, so a page can show values that are
	// only returned once, such as a Turnstile secret.
	const create = async (payload) => {
		const id = zoneId.value
		const key = getApiKey()
		const response = await call(
			list,
			{ currZone: id, action: 'create', [payloadKey]: payload },
			{ fallback: `Couldn’t create the ${label}` }
		)
		if (response?.result && getApiKey() === key) {
			store(id, normalise(response.result))
			markOtherZonesStale(id)
		}
		return response?.result
	}

	const update = async (itemId, payload) => {
		const id = zoneId.value
		const key = getApiKey()
		const response = await call(
			item,
			{ currZone: id, action: 'update', [idParam]: itemId, [payloadKey]: payload },
			{ fallback: `Couldn’t save the ${label}` }
		)
		if (response?.result && getApiKey() === key) {
			store(id, normalise(response.result))
			markOtherZonesStale(id)
		}
		return response?.result
	}

	const remove = async (itemId) => {
		const id = zoneId.value
		const key = getApiKey()
		await call(
			item,
			{ currZone: id, action: 'delete', [idParam]: itemId },
			{ fallback: `Couldn’t delete the ${label}` }
		)
		if (getApiKey() !== key) return
		markOtherZonesStale(id)
		const current = cache.value[id]
		if (!current) return
		bumpRevision(current)
		const before = current.items.length
		current.items = current.items.filter((existing) => existing[idKey] !== itemId)
		if (current.items.length < before) changeTotal(id, -1)
	}

	return {
		zoneId,
		items: computed(() => entry.value?.items || []),
		loading: computed(() => Boolean(entry.value?.loading)),
		loaded: computed(() => Boolean(entry.value?.fetchedAt)),
		error: computed(() => entry.value?.error || ''),
		resultInfo: computed(() => entry.value?.resultInfo || null),
		// Cloudflare reported more items than the first page returned.
		truncated: computed(() => {
			const total = entry.value?.resultInfo?.total_count
			return typeof total === 'number' && total > (entry.value?.items.length || 0)
		}),
		findItem: (itemId) => entry.value?.items.find((existing) => existing[idKey] === itemId) || null,
		load,
		refresh: () => load({ force: true }),
		create,
		update,
		remove
	}
}
