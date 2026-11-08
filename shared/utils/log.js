import * as Sentry from '@sentry/nuxt'
import { echoToConsole, scrub, scrubString } from './sentry.js'

// The app's logger, for the browser and the server. Each line goes to GlitchTip's log feed as
// "<area>: <what happened>", with the same facts as attributes, and to the console. GlitchTip
// shows the Service (dns-editor) beside every line, so the text doesn't repeat it. Use warn and
// error for anything that went wrong or fell back, info only for notable events (an account
// made, a record changed, a domain registered), never per request.
//
//   log.warn('cloudflare', logText`GET ${path} timed out after ${ms} ms`, { path, durationMs: ms })
//
// Write messages with the `logText` tag: it turns each value into text without ever throwing, so a
// request body field such as {"toString": 1} can't break the request it describes.
//
// `once` names a line to send at most once per `windowMs` (ten minutes by default); later
// copies within the window are counted and reported as `suppressed` on the next one.

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

const MAX_VALUE_LENGTH = 1000

const json = (value) => {
	try {
		return (JSON.stringify(value) ?? '').slice(0, MAX_VALUE_LENGTH)
	} catch {
		return '[unreadable]'
	}
}

// Any value as text, for log lines and attributes. Never throws: values from request bodies,
// headers and Cloudflare answers can be objects whose toString is missing or broken.
export function logValue(value) {
	try {
		if (typeof value === 'string') return value
		if (typeof value === 'function') return '[function]'
		if (value === null || value === undefined || typeof value !== 'object') return String(value)
		if (value instanceof Error) return logValue(value.message)
		if (Array.isArray(value)) {
			const items = value.map((item) => (item !== null && typeof item === 'object' ? json(item) : logValue(item)))
			return items.join(', ').slice(0, MAX_VALUE_LENGTH)
		}
		return json(value)
	} catch {
		return '[unreadable]'
	}
}

// A template tag for log messages: logText`${username} created ${type} ${name}`.
export function logText(strings, ...values) {
	let result = strings[0]
	for (let index = 0; index < values.length; index++) result += logValue(values[index]) + strings[index + 1]
	return result
}

// Error objects become their message, name, code and stack, which Sentry can't serialise alone.
export function errorFacts(error) {
	if (!error) return {}
	if (typeof error !== 'object') return { 'error.message': logValue(error) }
	const facts = { 'error.type': logValue(error.name || 'Error'), 'error.message': logValue(error.message ?? error) }
	const code = error.code ?? error.cause?.code
	if (code !== undefined) facts['error.code'] = logValue(code)
	const status = error.statusCode ?? error.status
	if (Number.isFinite(status)) facts['http.status_code'] = status
	if (error.stack) facts['error.stack'] = logValue(error.stack).slice(0, 4000)
	if (error.cause?.message) facts['error.cause'] = logValue(error.cause.message)
	return facts
}

function flatten(attributes) {
	const result = {}
	for (const [key, value] of Object.entries(attributes || {})) {
		if (value === undefined || value === null || value === '') continue
		if (value instanceof Error) Object.assign(result, errorFacts(value))
		else if (Array.isArray(value)) result[key] = value.length <= 20 ? logValue(value) : `${value.length} items`
		else if (typeof value === 'object') result[key] = logValue(scrub(value)).slice(0, 2000)
		else if (typeof value === 'symbol' || typeof value === 'function') result[key] = logValue(value)
		else result[key] = value
	}
	return result
}

function write(level, area, message, attributes = {}) {
	try {
		const { once, windowMs = DEFAULT_WINDOW_MS, error, ...rest } = attributes
		let extra = {}
		if (once) {
			const allowed = allow(logText`${level}:${area}:${once}`, windowMs)
			if (!allowed) return
			if (allowed.suppressed) extra = { suppressed: allowed.suppressed }
		}
		const facts = scrub(flatten({ area, ...rest, ...extra, ...(error && errorFacts(error)) }))
		const suffix = extra.suppressed ? ` (${extra.suppressed} more like this since the last one)` : ''
		const line = scrubString(`${logValue(area)}: ${logValue(message)}${suffix}`)
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

// Another service failing on its side (Cloudflare, a registry, a DNS resolver or OpenAI answering
// 5xx or 429, timing out or dropping the connection) isn't a fault of ours. It's logged at info,
// with one warning per area every 15 minutes while it lasts, or only at info when a stored copy
// covers it (`stale: true`).
const OUTAGE_WARN_MS = 15 * 60_000
const outageWarnings = new Map()

function outage(area, message, attributes = {}) {
	try {
		const key = logValue(area)
		const now = Date.now()
		const warn = !attributes?.stale && !(outageWarnings.get(key) > now)
		if (warn) outageWarnings.set(key, now + OUTAGE_WARN_MS)
		write(warn ? 'warn' : 'info', area, message, { ...attributes, outage: true })
	} catch {
		// Logging must never break the request it describes.
	}
}

export const log = {
	info: (area, message, attributes) => write('info', area, message, attributes),
	warn: (area, message, attributes) => write('warn', area, message, attributes),
	error: (area, message, attributes) => write('error', area, message, attributes),
	outage
}

// Milliseconds since `start` (from performance.now()), rounded, for durations in lines.
export const msSince = (start) => Math.round(performance.now() - start)
