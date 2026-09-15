const pending = new Map()

// Which Cloudflare features the token can use in a zone, probed once per token and zone
// and shared across pages. Concurrent callers share one in-flight request.
export function useCapabilities() {
	const state = useState('cf-capabilities', () => ({ apiKey: null, zones: {} }))

	const ensureKey = (apiKey) => {
		if (state.value.apiKey === apiKey) return
		state.value = { apiKey, zones: {} }
		pending.clear()
	}

	// A request that fails outright is stored like a failed probe, so pages waiting on the
	// check stop showing a skeleton and can offer to check again.
	const request = (cacheKey, body, store) => {
		if (pending.has(cacheKey)) return pending.get(cacheKey)
		const promise = $fetch('/api/capabilities', { method: 'POST', body })
			.catch(() => null)
			.then((data) => {
				if (state.value?.apiKey !== body.apiKey) return null
				return store(data)
			})
			.finally(() => pending.delete(cacheKey))
		pending.set(cacheKey, promise)
		return promise
	}

	// A failed probe is stored as null so the zone counts as checked (nothing available)
	// while the next load() retries it.
	const loadZone = async (apiKey, zoneId, { force = false } = {}) => {
		if (!apiKey || !zoneId) return null
		ensureKey(apiKey)
		if (!force && state.value.zones[zoneId]) return state.value.zones[zoneId]
		return request(`zone:${zoneId}`, { apiKey, currZone: zoneId }, (data) => {
			state.value.zones[zoneId] = data?.success ? data.result : null
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
