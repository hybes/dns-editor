// GlitchTip setup shared by the browser and the server: options, the secrets filter and the
// attributes every log carries. GlitchTip lists logs by `service.name` (Service) and
// `host.name` (Host), so every log names dns-editor and, on the server, the container.

export const DEFAULT_SENTRY_DSN = 'https://a7444553ec4443a990f21a5ba5ca60f7@error.cnnct.uk/14'
export const SERVICE_NAME = 'dns-editor'

export function isSentryTestRuntime(env = process.env) {
	return env.NODE_ENV === 'test' || ['true', '1'].includes(env.VITEST) || env.E2E_TEST_ORCHESTRATED === '1'
}

export function getSentryDsn(env = process.env, runtime = 'server') {
	const override = runtime === 'browser' ? env.NUXT_PUBLIC_SENTRY_DSN : env.SENTRY_DSN
	return (override ?? (env.NODE_ENV === 'production' ? DEFAULT_SENTRY_DSN : '')).trim()
}

// Only real secrets are removed: passwords, Cloudflare and other API tokens, Authorization
// headers, cookies and session ids, invite links, one-time, MFA and recovery codes, OAuth codes
// and state, signed URL signatures, TSIG and Turnstile secrets, database bound parameters and
// card data. Everything else (usernames, zone and record names, record contents, URLs, status
// codes, error messages and stacks) is kept.
const REDACTED = '[redacted]'

// Keys are compared by their last part (`request.data.otp` → otp), lower-cased with every
// separator removed, so api-key, X-API-Key, apiKey and api_key all read as apikey.
const leafOf = (key) =>
	String(key)
		.split(/[.[\]/]/)
		.filter(Boolean)
		.pop() || ''
const normalise = (key) =>
	leafOf(key)
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')

// Always secret, whatever the value's type: an OTP can be a number.
const SECRET_NAMES = new Set([
	'authorization',
	'proxyauthorization',
	'cookie',
	'cookies',
	'setcookie',
	'password',
	'passwd',
	'pwd',
	'pass',
	'current',
	'confirm',
	'secret',
	'apikey',
	'xapikey',
	'xauthkey',
	'xauthuserservicekey',
	'token',
	'session',
	'sessionid',
	'sid',
	'dmsession',
	'signature',
	'sig',
	'xamzcredential',
	'privatekey',
	'cvc',
	'cvv',
	'otp',
	'totp',
	'hotp',
	'mfa',
	'mfacode',
	'twofactorcode',
	'2facode',
	'verificationcode',
	'onetimecode',
	'onetimepassword',
	'recoverycode',
	'recoverycodes',
	'backupcode',
	'backupcodes'
])
// Secret when a name contains one of these and holds text (tokenCount stays a number).
const SECRET_PART =
	/password|passwd|passphrase|secret|token|apikey|authkey|authorization|cookie|signature|privatekey|cardnumber|otp|recoverycode|backupcode|onetime|mfacode/
// Names ending in id, hint, count or type (cfTokenId, token_hint, tokenType) hold safe values.
const SAFE_SUFFIX = /(?:id|ids|hint|count|type)$/
// Database drivers attach the values bound to a query, which can be anything.
const BOUND_PARAMS = new Set(['parameters', 'bindings', 'binds', 'bind', 'boundparameters', 'sqlparams'])
// Only secret in a URL or `name=value` text: in objects these are Cloudflare error codes.
const URL_ONLY = new Set(['code', 'state', 'oauthstate', 'authcode'])

export function isSecretKey(key) {
	const name = normalise(key)
	if (!name) return false
	if (SECRET_NAMES.has(name)) return true
	return !SAFE_SUFFIX.test(name) && SECRET_PART.test(name)
}

// code and state count only as whole names (?code=), not error.code.
const isUrlSecret = (key) =>
	isSecretKey(key) ||
	URL_ONLY.has(
		String(key)
			.toLowerCase()
			.replace(/[^a-z]/g, '')
	)

// "name": "value" pairs inside text that isn't valid JSON on its own.
const JSON_PAIR = /("([^"\\]{1,80})"\s*:\s*)("(?:[^"\\]|\\.)*"|-?\d+)/g
// name=value in query strings, form bodies and url.query attributes, at the start or after ?&;
const QUERY_PAIR = /(^|[?&;\s])([\w.[\]-]{1,80})=([^&#\s"';]*)/g
// A secret after any label: "Error: password=hunter2", "otp: 482913", "MFA code: 123456".
// A bare token= is left to QUERY_PAIR, so prose such as "token: rejected" survives.
const TEXT_PAIR =
	/((?<![\w-])(?:pass(?:word|wd|phrase)?|pwd|secret|client[_-]?secret|api[_-]?key|x-api-key|auth[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?id|otp|totp|(?:mfa|2fa|two[_-]?factor|verification|one[_ -]?time|recovery|backup|security)[_ -]?(?:code|password|pin)s?|private[_-]?key|signature)\b["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;"')}\]=:[][^\s&,;"')}\]]*)/gi
const BOUND_TEXT =
	/(\b(?:parameters|params|bindings|binds|bound parameters|with values)\s*[:=]?\s*)(\[[^\]]*\]|\{[^}]*\}|\([^)]*\))/gi
const BEARER = /\b(Bearer|Basic)\s+[\w~+/.=-]{8,}/gi
const INVITE_PATH = /(\/(?:api\/)?invite\/)[\w-]{16,}/gi
const SESSION_COOKIE = /\b(dm_session=)[^;\s"']+/gi
// Cloudflare API tokens are 40 characters of letters, digits, _ and -. Hex ids (zone, record,
// trace) never mix upper and lower case, so they are left alone.
const CF_TOKEN = /(?<![\w-])(?=[\w-]{40}(?![\w-]))(?=[\w-]*[A-Z])(?=[\w-]*[a-z])(?=[\w-]*\d)[\w-]{40}/g
// Long digit runs that pass the card checksum.
const CARD = /\b[2-6](?:[ -]?\d){12,18}\b/g

function luhn(digits) {
	let sum = 0
	for (let index = 0; index < digits.length; index++) {
		let digit = Number(digits[digits.length - 1 - index])
		if (index % 2) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2
		sum += digit
	}
	return sum % 10 === 0
}

// A string that is a JSON object or array is parsed and filtered as JSON, so an `=` inside a
// value isn't mistaken for a query string.
function scrubJsonText(value, depth, copies) {
	const text = value.trim()
	if (!/^(?:\{[\s\S]*\}|\[[\s\S]*\])$/.test(text)) return undefined
	try {
		return JSON.stringify(scrub(JSON.parse(text), depth + 1, copies))
	} catch {
		return undefined
	}
}

export function scrubString(value, depth = 0, copies = new Map()) {
	if (typeof value !== 'string' || value.length < 4) return value
	const json = depth < 12 ? scrubJsonText(value, depth, copies) : undefined
	if (json !== undefined) return json
	return value
		.replace(BEARER, `$1 ${REDACTED}`)
		.replace(JSON_PAIR, (match, prefix, key) => (isSecretKey(key) ? `${prefix}"${REDACTED}"` : match))
		.replace(QUERY_PAIR, (match, start, key, found) =>
			found && isUrlSecret(key) ? `${start}${key}=${REDACTED}` : match
		)
		.replace(TEXT_PAIR, `$1${REDACTED}`)
		.replace(BOUND_TEXT, `$1${REDACTED}`)
		.replace(INVITE_PATH, `$1${REDACTED}`)
		.replace(SESSION_COOKIE, `$1${REDACTED}`)
		.replace(CF_TOKEN, REDACTED)
		.replace(CARD, (match) => {
			const digits = match.replace(/\D/g, '')
			return digits.length >= 13 && luhn(digits) ? REDACTED : match
		})
}

const isPresent = (value) => value !== undefined && value !== null && value !== ''

// Walks any value, removing secret-named fields and secret-shaped text, at any depth. Returns a
// copy. Numbers under a name that only contains a secret word (token counts) are kept.
export function scrub(value, depth = 0, copies = new Map()) {
	if (typeof value === 'string') return scrubString(value, depth, copies)
	if (!value || typeof value !== 'object') return value
	if (copies.has(value)) return copies.get(value)
	if (depth > 12) return '[too deep]'
	if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value
	if (Array.isArray(value)) {
		const list = []
		copies.set(value, list)
		for (const item of value) list.push(scrub(item, depth + 1, copies))
		return list
	}
	const result = {}
	copies.set(value, result)
	for (const [key, item] of Object.entries(value)) {
		const name = normalise(key)
		if (!isPresent(item)) result[key] = item
		else if (SECRET_NAMES.has(name) || BOUND_PARAMS.has(name)) result[key] = REDACTED
		else if (name === 'params' && Array.isArray(item)) result[key] = REDACTED
		else if (isSecretKey(key) && (typeof item === 'string' || typeof item === 'object')) result[key] = REDACTED
		else result[key] = scrub(item, depth + 1, copies)
	}
	return result
}

// Errors and transactions keep everything apart from secrets. Request cookies never leave the
// server, and the logged-in user (id and username) is set by the server and the app.
export function sanitizeSentryEvent(event) {
	try {
		if (!event || typeof event !== 'object') return null
		const safe = scrub(event)
		if (safe.request) delete safe.request.cookies
		safe.tags = { ...safe.tags, application: SERVICE_NAME, service: SERVICE_NAME }
		return safe
	} catch {
		// A filter failure must never send unfiltered data, nor crash the app.
		return null
	}
}

// Spans keep their names, ops and attributes, without secrets. `data` is the static span form.
export function sanitizeSentrySpan(span) {
	try {
		return scrub(span)
	} catch {
		// Keep only the shape GlitchTip needs to place the span, never unfiltered text.
		const { span_id, trace_id, parent_span_id, op, start_timestamp, timestamp } = span || {}
		return {
			span_id,
			trace_id,
			parent_span_id,
			op,
			start_timestamp,
			timestamp,
			description: op || 'span',
			data: {}
		}
	}
}

// Every log line names the service, the host (servers only) and the runtime, and loses any
// secret that slipped into its text or attributes.
export function logAttributesFor({ runtime, host }) {
	return (log) => {
		const attributes = scrub(log.attributes || {})
		attributes['service.name'] = SERVICE_NAME
		if (host) attributes['host.name'] = host
		attributes.runtime ||= runtime
		return { ...log, message: scrubString(String(log.message ?? '')), attributes }
	}
}

// Set while the shared logger echoes a line to the console, so the console integration
// doesn't send a second, attribute-less copy of a line the logger has already sent.
let echoing = false
export function echoToConsole(write) {
	echoing = true
	try {
		write()
	} finally {
		echoing = false
	}
}

export function sentryOptions({ dsn, environment, runtime, host, disabled = false, consoleLogs }) {
	const addAttributes = logAttributesFor({ runtime, host })
	return {
		dsn,
		enabled: Boolean(dsn) && environment !== 'test' && !disabled,
		environment,
		sampleRate: 1,
		tracesSampleRate: environment === 'production' ? 0.01 : 0,
		traceLifecycle: 'static',
		tracePropagationTargets: [],
		enableLogs: true,
		// GlitchTip doesn't use release-health sessions, client reports, metrics, replay or profiles.
		sendClientReports: false,
		includeServerName: Boolean(host),
		dataCollection: {
			userInfo: true,
			cookies: false,
			httpHeaders: { request: true, response: false },
			httpBodies: ['incomingRequest'],
			urlQueryParams: true,
			graphQL: { document: true, variables: true },
			genAI: { inputs: false, outputs: false },
			mcp: { inputs: false, outputs: false },
			databaseQueryData: false,
			queues: false,
			stackFrameVariables: false
		},
		initialScope: { tags: { application: SERVICE_NAME, service: SERVICE_NAME, runtime } },
		integrations: (defaults) => [
			...defaults.filter((integration) => !['BrowserSession', 'ProcessSession'].includes(integration.name)),
			...(consoleLogs ? [consoleLogs] : [])
		],
		beforeSend: sanitizeSentryEvent,
		beforeSendTransaction: sanitizeSentryEvent,
		beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
		beforeSendLog: (log) => {
			if (echoing && log.attributes?.['sentry.origin'] === 'auto.log.console') return null
			return addAttributes(log)
		},
		beforeSendMetric: () => null
	}
}
