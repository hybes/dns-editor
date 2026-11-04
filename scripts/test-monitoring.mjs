import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as Sentry from '@sentry/nuxt'
import {
	DEFAULT_SENTRY_DSN,
	getSentryDsn,
	isSentryTestRuntime,
	sanitizeSentryEvent,
	sanitizeSentrySpan,
	sentryOptions
} from '../shared/utils/sentry.js'

const TOKEN = 'private-cloudflare-token-value'
const RECORD = 'private TXT record contents'
const PRIVATE = `${TOKEN} ${RECORD}`
const traceId = 'a'.repeat(32)
const spanId = 'b'.repeat(16)
const debugId = '12345678-1234-1234-1234-123456789abc'
const filename = 'https://dns.brth.dev/_nuxt/example.js'

const privateEvent = () => ({
	event_id: 'c'.repeat(32),
	message: PRIVATE,
	logentry: { formatted: PRIVATE, params: [PRIVATE] },
	request: { headers: { authorization: TOKEN, arbitrary: RECORD }, cookies: { session: TOKEN }, data: PRIVATE },
	user: { id: TOKEN, email: RECORD },
	extra: { error: PRIVATE },
	contexts: { nuxt: { path: `/invite/${TOKEN}` }, arbitrary: { value: RECORD } },
	breadcrumbs: [{ message: PRIVATE, data: { url: `https://example.com/${TOKEN}` } }],
	tags: { arbitrary: PRIVATE, runtime: 'server', test: 'glitchtip-migration' },
	fingerprint: [PRIVATE],
	sdkProcessingMetadata: { dynamicSamplingContext: { transaction: PRIVATE } },
	exception: {
		values: [
			{
				type: 'TypeError',
				value: PRIVATE,
				mechanism: { handled: false, data: { arbitrary: PRIVATE } },
				stacktrace: {
					frames: [
						{
							filename: `${filename}?token=${TOKEN}#${RECORD}`,
							lineno: 5,
							colno: 10,
							function: PRIVATE,
							vars: { arbitrary: PRIVATE },
							context_line: PRIVATE,
							pre_context: [PRIVATE],
							post_context: [PRIVATE]
						},
						{ filename: `https://example.com/invite/${TOKEN}` },
						{ filename: '/app/.output/server/chunks/routes/api/records.post.mjs', lineno: 7 }
					]
				}
			}
		]
	},
	debug_meta: { images: [{ type: 'sourcemap', code_file: filename, debug_id: debugId, arbitrary: PRIVATE }] }
})

function assertPrivateDataRemoved(value) {
	const json = JSON.stringify(value)
	assert.ok(!json.includes(TOKEN), json)
	assert.ok(!json.includes(RECORD), json)
}

test('DSNs default only in production, with separate browser and server overrides', () => {
	assert.equal(getSentryDsn({ NODE_ENV: 'production' }), DEFAULT_SENTRY_DSN)
	assert.equal(getSentryDsn({ NODE_ENV: 'production' }, 'browser'), DEFAULT_SENTRY_DSN)
	for (const NODE_ENV of ['development', 'test', undefined]) assert.equal(getSentryDsn({ NODE_ENV }), '')
	const env = { NODE_ENV: 'development', SENTRY_DSN: ' server ', NUXT_PUBLIC_SENTRY_DSN: ' browser ' }
	assert.equal(getSentryDsn(env), 'server')
	assert.equal(getSentryDsn(env, 'browser'), 'browser')
	assert.equal(getSentryDsn({ NODE_ENV: 'production', SENTRY_DSN: '' }), '')
	for (const env of [{ NODE_ENV: 'test' }, { VITEST: 'true' }, { VITEST: '1' }, { E2E_TEST_ORCHESTRATED: '1' }]) {
		assert.equal(isSentryTestRuntime(env), true)
	}
	assert.equal(isSentryTestRuntime({ NODE_ENV: 'production' }), false)
})

test('GlitchTip options disable unsupported features and content collection', () => {
	const options = sentryOptions({ dsn: DEFAULT_SENTRY_DSN, environment: 'production', runtime: 'server' })
	assert.equal(options.enabled, true)
	assert.equal(options.tracesSampleRate, 0.01)
	assert.equal(options.sampleRate, 1)
	assert.equal(options.traceLifecycle, 'static')
	assert.equal(options.sendClientReports, false)
	assert.equal(options.sendDefaultPii, false)
	assert.deepEqual(options.tracePropagationTargets, [])
	assert.deepEqual(options.dataCollection.httpBodies, [])
	assert.equal(options.dataCollection.httpHeaders, false)
	assert.equal(options.beforeSendLog({ body: PRIVATE }), null)
	assert.equal(options.beforeSendMetric({ value: PRIVATE }), null)
	assert.equal(options.beforeBreadcrumb({ message: PRIVATE }), null)
	const integrations = ['BrowserSession', 'ProcessSession', 'GlobalHandlers', 'OnUncaughtException'].map((name) => ({
		name
	}))
	assert.deepEqual(
		options.integrations(integrations).map((integration) => integration.name),
		['GlobalHandlers', 'OnUncaughtException']
	)
	assert.equal(sentryOptions({ ...options, runtime: 'server', environment: 'test' }).enabled, false)
	assert.equal(sentryOptions({ ...options, runtime: 'server', disabled: true }).enabled, false)
	assert.equal(sentryOptions({ ...options, runtime: 'browser', environment: 'development' }).tracesSampleRate, 0)
})

test('events retain error types, stack locations and source-map IDs without private values', () => {
	const event = privateEvent()
	const hint = { attachments: [{ filename: TOKEN, data: RECORD }] }
	const safe = sanitizeSentryEvent(event, hint)
	assertPrivateDataRemoved(safe)
	assert.deepEqual(hint.attachments, [])
	assert.equal(event.message, PRIVATE)
	assert.equal(safe.exception.values[0].type, 'TypeError')
	assert.equal(safe.exception.values[0].mechanism.handled, false)
	assert.deepEqual(safe.exception.values[0].stacktrace.frames, [
		{ filename: '/_nuxt/example.js', in_app: true, lineno: 5, colno: 10 },
		{ filename: 'app:///server/chunks/routes/api/records.post.mjs', in_app: true, lineno: 7 }
	])
	assert.deepEqual(safe.debug_meta.images, [{ type: 'sourcemap', code_file: '/_nuxt/example.js', debug_id: debugId }])
	assert.deepEqual(safe.tags, { application: 'dns-editor', runtime: 'server', test: 'glitchtip-migration' })
})

test('transactions and spans discard URLs, headers, attributes and arbitrary names', () => {
	const span = {
		trace_id: traceId,
		span_id: spanId,
		start_timestamp: 1,
		timestamp: 2,
		op: 'http.client',
		description: PRIVATE,
		data: { 'http.request.header.authorization': TOKEN, 'http.request.body': RECORD },
		links: [{ attributes: { private: PRIVATE } }]
	}
	const safe = sanitizeSentryEvent({
		...privateEvent(),
		type: 'transaction',
		transaction: `/invite/${TOKEN}?record=${RECORD}`,
		spans: [span],
		contexts: { trace: { ...span, arbitrary: PRIVATE } }
	})
	assertPrivateDataRemoved(safe)
	assert.equal(safe.transaction, 'dns-editor')
	assert.equal(safe.spans[0].timestamp - safe.spans[0].start_timestamp, 1)
	assert.equal(safe.contexts.trace.trace_id, traceId)
	assert.deepEqual(sanitizeSentrySpan(span).data, {})
})

test('unexpected fields and malformed values cannot bypass the filter', () => {
	const disguisedId = { toString: () => 'a'.repeat(32), private: PRIVATE }
	assertPrivateDataRemoved(sanitizeSentryEvent({ event_id: disguisedId }))
	assertPrivateDataRemoved(sanitizeSentryEvent({ message: PRIVATE, exception: { values: [{ type: PRIVATE }] } }))
	assertPrivateDataRemoved(sanitizeSentryEvent({ arbitraryFutureField: PRIVATE }))
	assert.equal(
		sanitizeSentryEvent({
			get exception() {
				throw new Error(PRIVATE)
			}
		}),
		null
	)
	assert.equal(sanitizeSentryEvent({ exception: { values: 'unexpected' } }), null)
	assert.equal(sanitizeSentryEvent(null), null)
})

test('the installed SDK sends only filtered errors and static transactions', async () => {
	const envelopes = []
	const client = Sentry.init({
		...sentryOptions({ dsn: DEFAULT_SENTRY_DSN, environment: 'production', runtime: 'server' }),
		tracesSampleRate: 1,
		beforeSendSpan: Sentry.withStaticSpan(sanitizeSentrySpan),
		transport: () => ({
			send: async (envelope) => {
				envelopes.push(envelope)
				return { statusCode: 200 }
			},
			flush: async () => true
		})
	})
	assert.ok(
		!client.getOptions().integrations.some((integration) => /^(Browser|Process)Session$/.test(integration.name))
	)
	Sentry.withScope((scope) => {
		scope.addAttachment({ filename: TOKEN, data: RECORD })
		Sentry.captureEvent(privateEvent())
	})
	await Sentry.startSpan({ name: PRIVATE, op: 'http.server', attributes: { private: PRIVATE } }, async () => {})
	Sentry.logger.info(PRIVATE)
	Sentry.metrics.count('private_metric', 1, { attributes: { private: PRIVATE } })
	assert.equal(await Sentry.flush(2000), true)
	await Sentry.close(2000)
	assertPrivateDataRemoved(envelopes)
	assert.deepEqual(envelopes.flatMap(([, items]) => items.map(([header]) => header.type)).sort(), [
		'event',
		'transaction'
	])
})
