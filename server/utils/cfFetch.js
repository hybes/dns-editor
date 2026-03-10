import { createHash } from 'node:crypto'
import fetch from 'node-fetch'

const cfCache = globalThis.__cfFetchCache || new Map()

if (!globalThis.__cfFetchCache) {
	globalThis.__cfFetchCache = cfCache
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

	const promise = performRequest({
		token: typeof apiKey === 'string' ? apiKey.trim() : '',
		method,
		path,
		body
	})
		.then((data) => {
			cfCache.set(cacheKey, {
				apiHash,
				method,
				path,
				expiresAt: Date.now() + cacheTtl,
				value: cloneValue(data)
			})
			return data
		})
		.catch((error) => {
			cfCache.delete(cacheKey)
			throw error
		})

	cfCache.set(cacheKey, {
		apiHash,
		method,
		path,
		expiresAt: now + cacheTtl,
		promise
	})

	return cloneValue(await promise)
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

export async function cfFetch({ apiKey, method = 'GET', path, body, cacheTtl = 0 }) {
	const upperMethod = typeof method === 'string' ? method.toUpperCase() : 'GET'

	return getCachedResponse({
		apiKey,
		method: upperMethod,
		path,
		body,
		cacheTtl
	})
}
