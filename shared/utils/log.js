import * as Sentry from '@sentry/nuxt'
import { echoToConsole, scrub, scrubString } from './sentry.js'

// The app's logger, for the browser and the server. Each line goes to GlitchTip's log feed as
// "[dns-editor] <area>: <what happened>", with the same facts as attributes, and to the
// console. Use warn and error for anything that went wrong or fell back, info only for notable
// events (an account made, a record changed, a domain registered), never per request.
//
//   log.warn('cloudflare', `GET ${path} timed out after ${ms} ms`, { path, durationMs: ms })
//
// `once` names a line to send at most once per `windowMs` (ten minutes by default); later
// copies within the window are counted and reported as `suppressed` on the next one.

// Written out rather than built from SERVICE_NAME: the server bundle can evaluate this module
// before sentry.js, and a top-level read of its constant would crash start-up.
const PREFIX = '[dns-editor]'
const DEFAULT_WINDOW_MS = 10 * 60_000
const MAX_THROTTLE_KEYS = 500
const throttled = new Map()

function allow(key, windowMs) {
	const now = Date.now()
	const entry = throttled.get(key)
	if (entry && entry.until > now) {
		entry.suppressed++
		return null
	}
	if (throttled.size >= MAX_THROTTLE_KEYS) {
		for (const [name, item] of throttled) if (item.until <= now) throttled.delete(name)
		if (throttled.size >= MAX_THROTTLE_KEYS) throttled.clear()
	}
	throttled.set(key, { until: now + windowMs, suppressed: 0 })
	return { suppressed: entry?.suppressed || 0 }
}

// Error objects become their message, name, code and stack, which Sentry can't serialise alone.
export function errorFacts(error) {
	if (!error) return {}
	if (typeof error !== 'object') return { 'error.message': String(error) }
	const facts = { 'error.type': error.name || 'Error', 'error.message': String(error.message ?? error) }
	const code = error.code ?? error.cause?.code
	if (code !== undefined) facts['error.code'] = String(code)
	const status = error.statusCode ?? error.status
	if (Number.isFinite(status)) facts['http.status_code'] = status
	if (error.stack) facts['error.stack'] = String(error.stack).slice(0, 4000)
	if (error.cause?.message) facts['error.cause'] = String(error.cause.message)
	return facts
}

function flatten(attributes) {
	const result = {}
	for (const [key, value] of Object.entries(attributes || {})) {
		if (value === undefined || value === null || value === '') continue
		if (value instanceof Error) Object.assign(result, errorFacts(value))
		else if (Array.isArray(value)) result[key] = value.length <= 20 ? value.join(', ') : `${value.length} items`
		else if (typeof value === 'object') result[key] = JSON.stringify(scrub(value)).slice(0, 2000)
		else result[key] = value
	}
	return result
}

function write(level, area, message, attributes = {}) {
	try {
		const { once, windowMs = DEFAULT_WINDOW_MS, error, ...rest } = attributes
		let extra = {}
		if (once) {
			const allowed = allow(`${level}:${area}:${once}`, windowMs)
			if (!allowed) return
			if (allowed.suppressed) extra = { suppressed: allowed.suppressed }
		}
		const facts = scrub(flatten({ area, ...rest, ...extra, ...(error && errorFacts(error)) }))
		const suffix = extra.suppressed ? ` (${extra.suppressed} more like this since the last one)` : ''
		const line = scrubString(`${PREFIX} ${area}: ${message}${suffix}`)
		Sentry.logger[level](line, facts)
		echoToConsole(() => {
			const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'
			if (error) console[method](line, facts['error.stack'] || facts['error.message'])
			else console[method](line)
		})
	} catch {
		// Logging must never break the request it describes.
	}
}

export const log = {
	info: (area, message, attributes) => write('info', area, message, attributes),
	warn: (area, message, attributes) => write('warn', area, message, attributes),
	error: (area, message, attributes) => write('error', area, message, attributes)
}

// Milliseconds since `start` (from performance.now()), rounded, for durations in lines.
export const msSince = (start) => Math.round(performance.now() - start)
