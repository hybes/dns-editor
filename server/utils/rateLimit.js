import { createError, getRequestIP } from 'h3'

// Slows password guessing: a fixed number of attempts per key in a window, counted in memory.
// A restart clears the counts, which is fine for a single self-hosted server.

const buckets = globalThis.__dnsManagerRateLimits || new Map()
if (!globalThis.__dnsManagerRateLimits) globalThis.__dnsManagerRateLimits = buckets

const MAX_KEYS = 10_000

export const clientIp = (event) => getRequestIP(event, { xForwardedFor: true }) || 'unknown'

// Throws a 429 once `key` has used `limit` attempts within `windowMs`.
export function limitAttempts(key, { limit, windowMs }) {
	const now = Date.now()
	const bucket = buckets.get(key)
	if (!bucket || bucket.resetAt <= now) {
		if (buckets.size >= MAX_KEYS) {
			for (const [name, entry] of buckets) if (entry.resetAt <= now) buckets.delete(name)
		}
		buckets.set(key, { count: 1, resetAt: now + windowMs })
		return
	}
	bucket.count++
	if (bucket.count > limit) {
		const minutes = Math.ceil((bucket.resetAt - now) / 60_000)
		throw createError({
			statusCode: 429,
			message: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
		})
	}
}

export const clearAttempts = (key) => buckets.delete(key)
