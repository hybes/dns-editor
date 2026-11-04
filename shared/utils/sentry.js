export const DEFAULT_SENTRY_DSN = 'https://a7444553ec4443a990f21a5ba5ca60f7@error.cnnct.uk/14'

export function isSentryTestRuntime(env = process.env) {
	return env.NODE_ENV === 'test' || ['true', '1'].includes(env.VITEST) || env.E2E_TEST_ORCHESTRATED === '1'
}

export function getSentryDsn(env = process.env, runtime = 'server') {
	const override = runtime === 'browser' ? env.NUXT_PUBLIC_SENTRY_DSN : env.SENTRY_DSN
	return (override ?? (env.NODE_ENV === 'production' ? DEFAULT_SENTRY_DSN : '')).trim()
}

const ERROR_TYPES = new Set([
	'Error',
	'TypeError',
	'ReferenceError',
	'SyntaxError',
	'RangeError',
	'URIError',
	'EvalError',
	'AggregateError',
	'FetchError',
	'CfApiError',
	'H3Error',
	'NuxtError',
	'AbortError',
	'TimeoutError'
])
const OPERATIONS = new Set([
	'http.server',
	'http.client',
	'pageload',
	'navigation',
	'resource.script',
	'resource.css',
	'db'
])
const LEVELS = new Set(['fatal', 'error', 'warning', 'info', 'debug'])

// Only build files belong in stacks. Drop URL queries, invitation paths and external URLs.
function stackFilename(value) {
	if (typeof value !== 'string') return undefined
	const path = new URL(value, 'file:///').pathname
	if (/^\/_nuxt\/[\w.-]+\.m?js$/.test(path)) return path
	const serverFile = path.match(/\/\.output\/server\/([\w./@+-]+\.m?js)$/)
	if (serverFile) return `app:///server/${serverFile[1]}`
	return undefined
}

function copyNumbers(source, target, fields) {
	for (const field of fields) {
		const value = source[field]
		if (Number.isFinite(value)) target[field] = value
	}
	return target
}

function traceFields(source = {}) {
	const result = { op: OPERATIONS.has(source.op) ? source.op : 'function' }
	for (const field of ['trace_id', 'span_id', 'parent_span_id']) {
		const value = source[field]
		if (typeof value === 'string' && /^(?:[a-f0-9]{16}|[a-f0-9]{32})$/i.test(value)) {
			result[field] = value
		}
	}
	return result
}

export function sanitizeSentrySpan(span) {
	return copyNumbers(span, { ...traceFields(span), data: {} }, ['start_timestamp', 'timestamp'])
}

// Tokens and record contents can be arbitrary strings, even in exception messages or error
// properties. Keep a small set of diagnostic fields instead of trying to recognise every secret.
export function sanitizeSentryEvent(event, hint = {}) {
	try {
		hint.attachments = []
		const safe = copyNumbers(event, { platform: 'javascript', level: 'error' }, ['timestamp', 'start_timestamp'])
		const eventId = event.event_id
		if (typeof eventId === 'string' && /^[a-f0-9]{32}$/i.test(eventId)) safe.event_id = eventId
		if (LEVELS.has(event.level)) safe.level = event.level
		if (['production', 'development', 'staging', 'test'].includes(event.environment)) {
			safe.environment = event.environment
		}
		safe.tags = { application: 'dns-editor' }
		if (['browser', 'server'].includes(event.tags?.runtime)) safe.tags.runtime = event.tags.runtime
		if (event.tags?.test === 'glitchtip-migration') safe.tags.test = 'glitchtip-migration'
		if (event.contexts?.trace) safe.contexts = { trace: traceFields(event.contexts.trace) }
		if (event.exception?.values) {
			safe.exception = {
				values: event.exception.values.map((exception) => ({
					type: ERROR_TYPES.has(exception.type) ? exception.type : 'Error',
					value: 'Error details removed for privacy',
					mechanism: { type: 'generic', handled: exception.mechanism?.handled !== false },
					stacktrace: {
						frames: (exception.stacktrace?.frames || []).flatMap((frame) => {
							const filename = stackFilename(frame.filename)
							return filename ? [copyNumbers(frame, { filename, in_app: true }, ['lineno', 'colno'])] : []
						})
					}
				}))
			}
		} else if (event.type !== 'transaction') {
			safe.message = 'Application error details removed for privacy'
		}
		if (event.type === 'transaction') {
			safe.type = 'transaction'
			safe.transaction = 'dns-editor'
			safe.transaction_info = { source: 'custom' }
			safe.spans = (event.spans || []).map(sanitizeSentrySpan)
		}
		if (event.debug_meta?.images) {
			safe.debug_meta = {
				images: event.debug_meta.images.flatMap((image) => {
					const codeFile = stackFilename(image.code_file)
					const debugId = image.debug_id
					return codeFile && typeof debugId === 'string' && /^[a-f0-9-]{36}$/i.test(debugId)
						? [{ type: 'sourcemap', code_file: codeFile, debug_id: debugId }]
						: []
				})
			}
		}
		return safe
	} catch {
		return null
	}
}

export function sentryOptions({ dsn, environment, runtime, disabled = false }) {
	return {
		dsn,
		enabled: Boolean(dsn) && environment !== 'test' && !disabled,
		environment,
		sampleRate: 1,
		tracesSampleRate: environment === 'production' ? 0.01 : 0,
		traceLifecycle: 'static',
		tracePropagationTargets: [],
		sendDefaultPii: false,
		sendClientReports: false,
		includeServerName: false,
		maxBreadcrumbs: 0,
		dataCollection: {
			userInfo: false,
			cookies: false,
			httpHeaders: false,
			httpBodies: [],
			urlQueryParams: false,
			graphQL: { document: false, variables: false },
			genAI: { inputs: false, outputs: false },
			mcp: { inputs: false, outputs: false },
			databaseQueryData: false,
			queues: false,
			stackFrameVariables: false,
			frameContextLines: 0
		},
		initialScope: { tags: { application: 'dns-editor', runtime } },
		integrations: (defaults) =>
			defaults.filter((integration) => !['BrowserSession', 'ProcessSession'].includes(integration.name)),
		beforeSend: sanitizeSentryEvent,
		beforeSendTransaction: sanitizeSentryEvent,
		beforeBreadcrumb: () => null,
		beforeSendLog: () => null,
		beforeSendMetric: () => null
	}
}
