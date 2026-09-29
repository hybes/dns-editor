const pending = new Map()

// Which Cloudflare features the account's connection can use in a zone, probed once per
// session and zone and shared across pages. Concurrent callers share one in-flight request.
export function useCapabilities() {
	// `access` is, per zone, whether it's shared with this account and at what levels.
	const state = useState('cf-capabilities', () => ({ key: null, zones: {}, access: {} }))

	const ensureKey = (key) => {
		if (state.value.key === key) return
		state.value = { key, zones: {}, access: {} }
		pending.clear()
	}

	// A request that fails outright is stored like a failed probe, so pages waiting on the
	// check stop showing a skeleton and can offer to check again.
	const request = (cacheKey, key, body, store) => {
		if (pending.has(cacheKey)) return pending.get(cacheKey)
		const promise = $fetch('/api/capabilities', { method: 'POST', body, timeout: 90_000 })
			.catch(() => null)
			.then((data) => {
				if (state.value?.key !== key) return null
				return store(data)
			})
			.finally(() => pending.delete(cacheKey))
		pending.set(cacheKey, promise)
		return promise
	}

	// A failed probe is stored as null so the zone counts as checked (nothing available)
	// while the next load() retries it.
	const loadZone = async (key, zoneId, { force = false } = {}) => {
		if (!key || !zoneId) return null
		ensureKey(key)
		if (!force && state.value.zones[zoneId]) return state.value.zones[zoneId]
		return request(`zone:${zoneId}`, key, { currZone: zoneId }, (data) => {
			state.value.zones[zoneId] = data?.success ? data.result : null
			state.value.access[zoneId] = data?.access || { shared: false }
			return state.value.zones[zoneId]
		})
	}

	const missing = (caps) => {
		if (!caps) return []
		return Object.entries(caps)
			.filter(([_, v]) => v && v.available === false)
			.map(([k, v]) => ({ key: k, reason: v.reason || 'Unavailable' }))
	}

	const can = (caps, key) => Boolean(caps && caps[key] && caps[key].available)

	return {
		state,
		loadZone,
		missing,
		can
	}
}
