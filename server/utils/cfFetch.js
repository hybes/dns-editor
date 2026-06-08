import { createHash } from 'node:crypto'

// Use the runtime's global fetch (undici on Node 18+/Nitro). Unlike node-fetch v2 it
// natively serializes Web FormData/Blob, which the zone-import multipart request needs.

const cfCache = globalThis.__cfFetchCache || new Map()

if (!globalThis.__cfFetchCache) {
	globalThis.__cfFetchCache = cfCache
}

// Bound the in-memory cache so a flood of distinct paths can't exhaust memory.
const MAX_CACHE_ENTRIES = 1000

const sweepCache = () => {
	const now = Date.now()
	for (const [key, entry] of cfCache) {
		if (entry?.value && entry.expiresAt <= now) cfCache.delete(key)
	}
	if (cfCache.size <= MAX_CACHE_ENTRIES) return
	// Evict oldest resolved entries until back under the cap; never evict an in-flight
	// pending entry, or its own write-back would be silently skipped.
	const overflow = cfCache.size - MAX_CACHE_ENTRIES
	let removed = 0
	for (const key of cfCache.keys()) {
		const entry = cfCache.get(key)
		if (entry && !entry.value) continue
		cfCache.delete(key)
		if (++removed >= overflow) break
	}
}

// Reject path traversal / control characters before a value is interpolated into a
// Cloudflare API URL. IDs come from client-supplied bodies, so this guards against a
// crafted zone/record id breaking out of the intended path.
const assertSafePath = (path) => {
	if (typeof path !== 'string' || !path.startsWith('/')) {
		throw new Error('Invalid API path')
	}
	if (path.includes('..') || /[\s<>"\\^`{}|]|%2e%2e/i.test(path)) {
		throw new Error('Invalid API path')
	}
}

const cloneValue = (value) => {
	if (value === null || value === undefined) return value
	if (typeof structuredClone === 'function') return structuredClone(value)
	return JSON.parse(JSON.stringify(value))
}

const getApiHash = (apiKey) =>
	createHash('sha1')
		.update(typeof apiKey === 'string' ? apiKey.trim() : '')
		.digest('hex')

const getCacheKey = ({ apiHash, method, path }) => `${method}:${apiHash}:${path}`

const performRequest = async ({ token, method, path, body }) => {
	const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json'
		},
		body: body ? JSON.stringify(body) : undefined
	})

	let data
	try {
		data = await response.json()
	} catch {
		data = null
	}

	if (!data) {
		return {
			success: false,
			errors: [{ message: `HTTP Error: ${response.status}` }]
		}
	}

	if (!response.ok && data.success !== false) {
		return {
			success: false,
			errors: [{ message: `HTTP Error: ${response.status}` }]
		}
	}

	return data
}

const getCachedResponse = async ({ apiKey, method, path, cacheTtl, body }) => {
	if (!cacheTtl || cacheTtl <= 0 || method !== 'GET') {
		return performRequest({
			token: typeof apiKey === 'string' ? apiKey.trim() : '',
			method,
			path,
			body
		})
	}

	const apiHash = getApiHash(apiKey)
	const cacheKey = getCacheKey({ apiHash, method, path })
	const now = Date.now()
	const entry = cfCache.get(cacheKey)

	if (entry?.value && entry.expiresAt > now) {
		return cloneValue(entry.value)
	}

	if (entry?.promise) {
		return cloneValue(await entry.promise)
	}

	const pendingEntry = { apiHash, method, path, expiresAt: now + cacheTtl }

	pendingEntry.promise = performRequest({
		token: typeof apiKey === 'string' ? apiKey.trim() : '',
		method,
		path,
		body
	})
		.then((data) => {
			// Only persist the resolved value if this entry is still the live one.
			// An invalidate() (or a newer request) may have replaced/removed it meanwhile.
			if (cfCache.get(cacheKey) === pendingEntry) {
				cfCache.set(cacheKey, {
					apiHash,
					method,
					path,
					expiresAt: Date.now() + cacheTtl,
					value: cloneValue(data)
				})
				sweepCache()
			}
			return data
		})
		.catch((error) => {
			if (cfCache.get(cacheKey) === pendingEntry) cfCache.delete(cacheKey)
			throw error
		})

	cfCache.set(cacheKey, pendingEntry)

	return cloneValue(await pendingEntry.promise)
}

export function invalidateCfCache({ apiKey, paths = [] } = {}) {
	const apiHash = apiKey ? getApiHash(apiKey) : ''

	for (const [cacheKey, entry] of cfCache.entries()) {
		if (entry?.method !== 'GET') continue
		if (apiHash && entry.apiHash !== apiHash) continue
		if (paths.length && !paths.some((prefix) => entry.path.startsWith(prefix))) continue
		cfCache.delete(cacheKey)
	}
}

// Fetch a plain-text Cloudflare response (e.g. the BIND zone-file export endpoint,
// which returns text/plain rather than the usual JSON envelope). Not cached.
export async function cfFetchText({ apiKey, path }) {
	assertSafePath(path)
	const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
		method: 'GET',
		headers: { Authorization: `Bearer ${typeof apiKey === 'string' ? apiKey.trim() : ''}` }
	})
	const text = await response.text()
	if (!response.ok) {
		return { success: false, errors: [{ message: `HTTP Error: ${response.status}` }] }
	}
	return { success: true, text }
}

// POST a multipart/form-data body to Cloudflare (e.g. the BIND zone-file import
// endpoint, which expects a `file` field). Returns the parsed JSON envelope.
export async function cfFetchMultipart({ apiKey, path, form }) {
	assertSafePath(path)
	const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${typeof apiKey === 'string' ? apiKey.trim() : ''}` },
		body: form
	})
	let data
	try {
		data = await response.json()
	} catch {
		data = null
	}
	if (!data) {
		return { success: false, errors: [{ message: `HTTP Error: ${response.status}` }] }
	}
	return data
}

export async function cfFetch({ apiKey, method = 'GET', path, body, cacheTtl = 0 }) {
	assertSafePath(path)
	const upperMethod = typeof method === 'string' ? method.toUpperCase() : 'GET'

	return getCachedResponse({
		apiKey,
		method: upperMethod,
		path,
		body,
		cacheTtl
	})
}
