import { createHash } from 'node:crypto'

// Use the runtime's global fetch (undici on Node 18+/Nitro). Unlike node-fetch v2 it
// natively serializes Web FormData/Blob, which multipart requests such as zone import need.

const cfCache = globalThis.__cfFetchCache || new Map()

if (!globalThis.__cfFetchCache) {
	globalThis.__cfFetchCache = cfCache
}

// Bound the in-memory cache so a flood of distinct paths can't exhaust memory.
const MAX_CACHE_ENTRIES = 1000

// Cloudflare's API. CLOUDFLARE_API_BASE points the server at a stand-in Cloudflare for the
// end-to-end tests (scripts/test-e2e.mjs); leave it unset everywhere else.
const API_BASE = (process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '')

// Cloudflare occasionally stalls; give up rather than leave a page spinning forever. Routes
// that move a large file pass a longer `timeout`.
const REQUEST_TIMEOUT_MS = 20_000

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

// A path segment that URLs treat as "this folder" or "up one", written plainly or encoded.
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i

// Reject path traversal / control characters before a value is interpolated into a
// Cloudflare API URL. IDs come from client-supplied bodies, so this guards against a
// crafted zone/record id breaking out of the intended path. Dots inside a segment, as in an
// R2 key like notes..txt, are fine; fetch only resolves segments that are just . or ..
const assertSafePath = (path) => {
	if (typeof path !== 'string' || !path.startsWith('/')) {
		throw new Error('Invalid API path')
	}
	if (path.split('/').some((segment) => DOT_SEGMENT.test(segment)) || /[\s<>"\\^`{}|]/.test(path)) {
		throw new Error('Invalid API path')
	}
}

// Query strings come from URLSearchParams (see cfCommand.js), so they are already encoded;
// this only stops a stray space or fragment turning into a different request.
const assertSafeQuery = (query) => {
	if (query && (typeof query !== 'string' || !query.startsWith('?') || /[\s#]/.test(query))) {
		throw new Error('Invalid API query')
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

const getCacheKey = ({ apiHash, method, url }) => `${method}:${apiHash}:${url}`

const bearer = (apiKey) => `Bearer ${typeof apiKey === 'string' ? apiKey.trim() : ''}`

const errorEnvelope = (message) => ({ success: false, errors: [{ message }] })

const timeoutEnvelope = (timeout = REQUEST_TIMEOUT_MS) =>
	errorEnvelope(`Cloudflare didn’t respond within ${Math.round(timeout / 1000)} seconds. Try again.`)

const isTimeout = (error) => error?.name === 'TimeoutError' || error?.name === 'AbortError'

// Returns null when Cloudflare doesn't answer in time; other network failures throw.
const cloudflareFetch = async (path, init, timeout = REQUEST_TIMEOUT_MS) => {
	try {
		return await fetch(`${API_BASE}${path}`, {
			...init,
			signal: AbortSignal.timeout(timeout)
		})
	} catch (error) {
		if (isTimeout(error)) return null
		throw error
	}
}

const readJson = async (response, timeout) => {
	try {
		return await response.json()
	} catch (error) {
		if (isTimeout(error)) return timeoutEnvelope(timeout)
		return null
	}
}

// `body` is sent as JSON; `rawBody` is sent as it is with `contentType`, for the few
// endpoints that take another format (SCIM, KV values). `headers` are the extra request
// headers some commands set, such as Prefer.
const performRequest = async ({ token, method, url, headers, body, rawBody, contentType, timeout }) => {
	const raw = rawBody !== undefined
	// A command can set the content type itself, such as an R2 object's (`--content-type`).
	const given = Object.entries(headers || {}).find(([name]) => name.toLowerCase() === 'content-type')
	const others = Object.fromEntries(
		Object.entries(headers || {}).filter(([name]) => name.toLowerCase() !== 'content-type')
	)
	const response = await cloudflareFetch(
		url,
		{
			method,
			headers: {
				...others,
				Authorization: bearer(token),
				'Content-Type': given?.[1] || (raw ? contentType || 'application/octet-stream' : 'application/json')
			},
			body: raw ? rawBody : body == null ? undefined : JSON.stringify(body)
		},
		timeout
	)
	if (!response) return timeoutEnvelope(timeout)

	const data = await readJson(response, timeout)

	if (!data) {
		// Some deletes answer 204 with no body at all, which is still a success.
		if (response.ok) return { success: true, errors: [], messages: [], result: null }
		return errorEnvelope(`HTTP Error: ${response.status}`)
	}

	if (!response.ok && data.success !== false) {
		return errorEnvelope(`HTTP Error: ${response.status}`)
	}

	return data
}

const getCachedResponse = async ({ apiKey, method, path, query, cacheTtl, fresh, ...request }) => {
	const url = `${path}${query}`
	if (!cacheTtl || cacheTtl <= 0 || method !== 'GET') {
		return performRequest({ token: apiKey, method, url, ...request })
	}

	const apiHash = getApiHash(apiKey)
	const cacheKey = getCacheKey({ apiHash, method, url })
	const now = Date.now()
	let entry = cfCache.get(cacheKey)

	// An explicit refresh drops a stored answer but still shares a request already in flight.
	if (fresh && entry?.value) {
		cfCache.delete(cacheKey)
		entry = undefined
	}

	if (entry?.value && entry.expiresAt > now) {
		return cloneValue(entry.value)
	}

	if (entry?.promise) {
		return cloneValue(await entry.promise)
	}

	// Invalidation matches on `path`, which carries the query so a prefix also clears
	// filtered and paginated reads of the same list.
	const pendingEntry = { apiHash, method, path: url, expiresAt: now + cacheTtl }

	pendingEntry.promise = performRequest({ token: apiKey, method, url, ...request })
		.then((data) => {
			// Only persist the resolved value if this entry is still the live one.
			// An invalidate() (or a newer request) may have replaced/removed it meanwhile.
			// Failures are never cached, so a retry goes back to Cloudflare.
			if (cfCache.get(cacheKey) === pendingEntry) {
				if (data?.success === true) {
					cfCache.set(cacheKey, {
						apiHash,
						method,
						path: url,
						expiresAt: Date.now() + cacheTtl,
						value: cloneValue(data)
					})
					sweepCache()
				} else {
					cfCache.delete(cacheKey)
				}
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

// Content types shown as text; anything else (a PDF, a screenshot) comes back as base64.
const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-ndjson|dns)|[^;]*\+(json|xml))/i

// Fetch a response that isn't Cloudflare's JSON envelope, such as the BIND zone-file export
// or an R2 object. `body`, when given, is sent as JSON. Failures still come back as the JSON
// envelope. Not cached.
// Resolves to { success: true, contentType, text } or { success: true, contentType, base64 };
// with `as: 'buffer'`, to { success: true, contentType, buffer } for routes that pass the
// bytes straight on, such as a file download.
export async function cfFetchRaw({ apiKey, method = 'GET', path, query = '', headers, body, as, timeout }) {
	assertSafePath(path)
	assertSafeQuery(query)
	const response = await cloudflareFetch(
		`${path}${query}`,
		{
			method,
			headers: {
				...headers,
				Authorization: bearer(apiKey),
				...(body != null && { 'Content-Type': 'application/json' })
			},
			body: body == null ? undefined : JSON.stringify(body)
		},
		timeout
	)
	if (!response) return timeoutEnvelope(timeout)
	let bytes
	try {
		bytes = Buffer.from(await response.arrayBuffer())
	} catch (error) {
		if (isTimeout(error)) return timeoutEnvelope(timeout)
		throw error
	}
	if (!response.ok) {
		// Failures come back as Cloudflare's JSON envelope; keep its message when present.
		try {
			const data = JSON.parse(bytes.toString('utf8'))
			if (data?.errors?.length) return { success: false, errors: data.errors }
		} catch {
			// Not JSON; fall through to the status code.
		}
		return errorEnvelope(`HTTP Error: ${response.status}`)
	}
	const contentType = response.headers.get('content-type') || ''
	if (as === 'buffer') return { success: true, contentType, buffer: bytes }
	if (!contentType || TEXT_TYPES.test(contentType)) {
		return { success: true, contentType, text: bytes.toString('utf8') }
	}
	return { success: true, contentType, base64: bytes.toString('base64') }
}

// Send a multipart/form-data body (e.g. the BIND zone-file import endpoint, which expects a
// `file` field). Returns the parsed JSON envelope.
export async function cfFetchMultipart({ apiKey, method = 'POST', path, query = '', headers, form }) {
	assertSafePath(path)
	assertSafeQuery(query)
	const response = await cloudflareFetch(`${path}${query}`, {
		method,
		headers: { ...headers, Authorization: bearer(apiKey) },
		body: form
	})
	if (!response) return timeoutEnvelope()
	const data = await readJson(response)
	if (!data) {
		return errorEnvelope(`HTTP Error: ${response.status}`)
	}
	return data
}

// `fresh: true` skips a stored GET answer, for explicit refreshes and retries; `timeout` is in
// milliseconds. `query` is an encoded query string starting with `?`; keeping it apart from
// `path` lets the path checks run on the part that names the resource.
export async function cfFetch({
	apiKey,
	method = 'GET',
	path,
	query = '',
	headers,
	body,
	rawBody,
	contentType,
	cacheTtl = 0,
	fresh = false,
	timeout
}) {
	assertSafePath(path)
	assertSafeQuery(query)
	const upperMethod = typeof method === 'string' ? method.toUpperCase() : 'GET'

	return getCachedResponse({
		apiKey,
		method: upperMethod,
		path,
		query,
		headers,
		body,
		rawBody,
		contentType,
		cacheTtl,
		fresh,
		timeout
	})
}
