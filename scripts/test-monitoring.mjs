import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { test } from 'node:test'
import * as Sentry from '@sentry/nuxt'
import { log } from '../shared/utils/log.js'
import {
	collectsRequestBody,
	consoleRunFacts,
	DEFAULT_SENTRY_DSN,
	getSentryDsn,
	isSentryTestRuntime,
	logAttributesFor,
	sanitizeSentryEvent,
	sanitizeSentrySpan,
	scrub,
	scrubString,
	sentryOptions
} from '../shared/utils/sentry.js'

// Secrets that must never reach GlitchTip, and ordinary data that must.
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-Qz'
const PASSWORD = 'correct horse battery staple'
const SESSION = 'c2Vzc2lvbi12YWx1ZS10aGF0LWlzLXNlY3JldC0xMjM'
const INVITE = 'aW52aXRlLXRva2VuLXZhbHVlLXRoYXQtaXMtc2VjcmV0'
const CARD = '4111 1111 1111 1111'
const SECRETS = [TOKEN, PASSWORD, SESSION, INVITE, CARD]
const KEPT = ['ben', 'www.example.com', 'v=spf1 include:_spf.example.com ~all', '023e105f4ecef8ad9ca31a8372d0c353']

function assertNoSecrets(value) {
	const json = JSON.stringify(value)
	for (const secret of SECRETS) assert.ok(!json.includes(secret), `${secret} leaked: ${json}`)
}

function assertKept(value, kept = KEPT) {
	const json = JSON.stringify(value)
	for (const item of kept) assert.ok(json.includes(item), `${item} was removed: ${json}`)
}

const errorEvent = () => ({
	event_id: 'c'.repeat(32),
	level: 'error',
	message: `Cloudflare said no for www.example.com with Bearer ${TOKEN}`,
	request: {
		url: `https://dns.brth.dev/invite/${INVITE}?token=${TOKEN}&zone=023e105f4ecef8ad9ca31a8372d0c353`,
		headers: { authorization: `Bearer ${TOKEN}`, cookie: `dm_session=${SESSION}`, 'user-agent': 'Firefox' },
		cookies: { dm_session: SESSION },
		data: JSON.stringify({ apiKey: TOKEN, password: PASSWORD, dns: { name: 'www.example.com' } })
	},
	user: { id: '7', username: 'ben' },
	extra: { card: `paid with ${CARD}`, content: 'v=spf1 include:_spf.example.com ~all' },
	tags: { runtime: 'server' },
	breadcrumbs: [
		{ message: `GET /zones?apiKey=${TOKEN}`, data: { url: 'https://api.cloudflare.com/client/v4/zones' } }
	],
	exception: {
		values: [
			{
				type: 'TypeError',
				value: `Couldn’t read 023e105f4ecef8ad9ca31a8372d0c353 with ${TOKEN}`,
				stacktrace: {
					frames: [{ filename: '/app/.output/server/chunks/routes/api/records.post.mjs', lineno: 7 }]
				}
			}
		]
	}
})

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

test('options send logs, keep unsupported features off and sample traces lightly', () => {
	const options = sentryOptions({
		dsn: DEFAULT_SENTRY_DSN,
		environment: 'production',
		runtime: 'server',
		host: 'web-1'
	})
	assert.equal(options.enabled, true)
	assert.equal(options.enableLogs, true)
	assert.equal(options.sampleRate, 1)
	assert.equal(options.tracesSampleRate, 0.01)
	assert.equal(options.sendClientReports, false)
	assert.equal(options.dataCollection.cookies, false)
	assert.equal(options.beforeSendMetric({ value: 1 }), null)
	assert.notEqual(options.beforeSendLog({ level: 'warn', message: 'x', attributes: {} }), null)
	assert.deepEqual(options.initialScope.tags, { application: 'dns-editor', service: 'dns-editor', runtime: 'server' })
	const integrations = ['BrowserSession', 'ProcessSession', 'GlobalHandlers'].map((name) => ({ name }))
	assert.deepEqual(
		options.integrations(integrations).map((integration) => integration.name),
		['GlobalHandlers']
	)
	assert.equal(sentryOptions({ ...options, environment: 'test' }).enabled, false)
	assert.equal(sentryOptions({ ...options, disabled: true }).enabled, false)
	assert.equal(sentryOptions({ ...options, dsn: '' }).enabled, false)
	assert.equal(sentryOptions({ ...options, environment: 'development' }).tracesSampleRate, 0)
})

test('events keep users, URLs, messages and stacks, and lose only secrets', () => {
	const event = errorEvent()
	const safe = sanitizeSentryEvent(event)
	assertNoSecrets(safe)
	assertKept(safe)
	assert.equal(event.request.cookies.dm_session, SESSION, 'the original event is not changed')
	assert.equal(safe.request.cookies, undefined)
	assert.equal(safe.request.headers.authorization, '[redacted]')
	assert.equal(safe.request.headers['user-agent'], 'Firefox')
	assert.deepEqual(safe.user, { id: '7', username: 'ben' })
	assert.equal(safe.exception.values[0].type, 'TypeError')
	assert.match(safe.exception.values[0].value, /^Couldn’t read 023e105f4ecef8ad9ca31a8372d0c353 with/)
	assert.equal(safe.exception.values[0].stacktrace.frames[0].lineno, 7)
	assert.deepEqual(safe.tags, { runtime: 'server', application: 'dns-editor', service: 'dns-editor' })
	assert.match(safe.request.url, /zone=023e105f4ecef8ad9ca31a8372d0c353/)
})

test('the secret filter knows names and shapes, not just exact fields', () => {
	const cleaned = scrub({
		password: PASSWORD,
		current: PASSWORD,
		newPassword: PASSWORD,
		inviteToken: INVITE,
		secret: 'tsig-secret-value',
		nested: [{ Authorization: `Bearer ${TOKEN}` }],
		cfTokenId: 'f267e341f3dd4697bd3b9f71dd96247f',
		token_hint: '…9_-Qz',
		total_tokens: 812,
		errors: [{ code: 81057, message: 'Record already exists.' }],
		timestamp: '1730700000000'
	})
	assertNoSecrets(cleaned)
	assert.equal(cleaned.secret, '[redacted]')
	assert.equal(cleaned.cfTokenId, 'f267e341f3dd4697bd3b9f71dd96247f')
	assert.equal(cleaned.token_hint, '…9_-Qz')
	assert.equal(cleaned.total_tokens, 812)
	assert.deepEqual(cleaned.errors, [{ code: 81057, message: 'Record already exists.' }])
	assert.equal(cleaned.timestamp, '1730700000000')
	assert.equal(
		scrubString(`/api/r2_download?key=docs/report.pdf&X-Amz-Signature=abcdef123456`),
		'/api/r2_download?key=docs/report.pdf&X-Amz-Signature=[redacted]'
	)
	assert.equal(
		scrubString(`callback?code=oauth-code-123&state=xyz789abc`),
		'callback?code=[redacted]&state=[redacted]'
	)
	const cyclic = { name: 'www.example.com', password: PASSWORD }
	cyclic.self = cyclic
	assert.doesNotThrow(() => scrub(cyclic))
	assert.equal(sanitizeSentryEvent(null), null)
})

test('spans keep names and attributes without secrets', () => {
	const span = sanitizeSentrySpan({
		description: `POST /api/records?token=${TOKEN}`,
		op: 'http.server',
		data: { 'http.request.header.authorization': `Bearer ${TOKEN}`, 'url.path': '/api/records' }
	})
	assertNoSecrets(span)
	assert.equal(span.data['url.path'], '/api/records')
	assert.match(span.description, /^POST \/api\/records/)
})

test('every log names the service, the host on servers and the runtime', () => {
	const server = logAttributesFor({ runtime: 'server', host: 'web-1' })({
		level: 'warn',
		message: `[dns-editor] cloudflare: GET /zones failed with Bearer ${TOKEN}`,
		attributes: { path: '/zones', password: PASSWORD }
	})
	assertNoSecrets(server)
	assert.equal(server.attributes['service.name'], 'dns-editor')
	assert.equal(server.attributes['host.name'], 'web-1')
	assert.equal(server.attributes.runtime, 'server')
	assert.equal(server.attributes.path, '/zones')
	const browser = logAttributesFor({ runtime: 'browser' })({ level: 'error', message: 'x', attributes: {} })
	assert.equal(browser.attributes['host.name'], undefined)
	assert.equal(browser.attributes.runtime, 'browser')
	const cron = logAttributesFor({ runtime: 'server', host: 'web-1' })({
		message: 'x',
		attributes: { runtime: 'cron' }
	})
	assert.equal(cron.attributes.runtime, 'cron')
})

test('the installed SDK sends filtered errors and structured logs once each', async () => {
	const envelopes = []
	Sentry.init({
		...sentryOptions({
			dsn: DEFAULT_SENTRY_DSN,
			environment: 'production',
			runtime: 'server',
			host: 'web-1',
			consoleLogs: Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] })
		}),
		beforeSendSpan: Sentry.withStaticSpan(sanitizeSentrySpan),
		transport: () => ({
			send: async (envelope) => {
				envelopes.push(envelope)
				return { statusCode: 200 }
			},
			flush: async () => true
		})
	})
	// The logger echoes each line to the console; the console integration must not send it twice.
	Sentry.captureEvent(errorEvent())
	log.warn('cloudflare', `GET /zones timed out after 20000 ms`, { path: '/zones', timeoutMs: 20000, apiKey: TOKEN })
	log.error('api', 'POST /api/records failed 500', { error: new TypeError(`fetch failed for ${TOKEN}`) })
	log.info('dns', 'ben created A www.example.com', { recordName: 'www.example.com', once: 'x' })
	log.info('dns', 'ben created A www.example.com', { recordName: 'www.example.com', once: 'x' })
	console.warn('third-party warning about www.example.com')
	Sentry.metrics.count('unused_metric', 1)
	assert.equal(await Sentry.flush(2000), true)
	await Sentry.close(2000)
	assertNoSecrets(envelopes)
	const items = envelopes.flatMap(([, list]) => list)
	assert.deepEqual([...new Set(items.map(([header]) => header.type))].sort(), ['event', 'log'])
	const logs = items.filter(([header]) => header.type === 'log').flatMap(([, payload]) => payload.items)
	const bodies = logs.map((item) => item.body)
	assert.deepEqual(bodies, [
		'[dns-editor] cloudflare: GET /zones timed out after 20000 ms',
		'[dns-editor] api: POST /api/records failed 500',
		'[dns-editor] dns: ben created A www.example.com',
		'third-party warning about www.example.com'
	])
	for (const item of logs) {
		assert.equal(item.attributes['service.name'].value, 'dns-editor')
		assert.equal(item.attributes['host.name'].value, 'web-1')
		assert.equal(item.attributes.runtime.value, 'server')
	}
	assert.equal(logs[0].attributes.timeoutMs.value, 20000)
	assert.equal(logs[1].attributes['error.type'].value, 'TypeError')
	assert.match(logs[1].attributes['error.stack'].value, /TypeError: fetch failed for \[redacted\]/)
	const event = items.find(([header]) => header.type === 'event')[1]
	assert.equal(event.tags.service, 'dns-editor')
	assert.equal(event.user.username, 'ben')
})

test('a secret after a non-secret label is still redacted', () => {
	assert.equal(scrubString('Error: password=hunter2'), 'Error: password=[redacted]')
	assert.equal(scrubString('Failure: access_token=abc'), 'Failure: access_token=[redacted]')
	assert.equal(scrubString('error: otp=482913'), 'error: otp=[redacted]')
	assert.equal(scrubString('MFA code: 123456 rejected'), 'MFA code: [redacted] rejected')
	assert.equal(scrubString('recovery code = ab12-cd34'), 'recovery code = [redacted]')
	// Ordinary prose that mentions tokens is left alone.
	assert.equal(scrubString('set-up token kept'), 'set-up token kept')
	assert.equal(
		scrubString('couldn’t delete the set-up token tok-setup for ben'),
		'couldn’t delete the set-up token tok-setup for ben'
	)
	assert.equal(
		scrubString('Cloudflare rejected this token: Invalid format'),
		'Cloudflare rejected this token: Invalid format'
	)
})

test('keys match in any spelling and at any depth, including dotted leaf names', () => {
	const cleaned = scrub({
		'api-key': 'k1',
		'X-API-Key': 'k2',
		apiKey: 'k3',
		api_key: 'k4',
		request: { data: { otp: 482913, recovery_codes: ['a1', 'b2'], mfaCode: '123456' } },
		'request.data.otp': '482913',
		'http.request.header.authorization': 'Bearer abc',
		deep: [{ list: [{ Password: 'hunter2' }] }]
	})
	assert.deepEqual(cleaned, {
		'api-key': '[redacted]',
		'X-API-Key': '[redacted]',
		apiKey: '[redacted]',
		api_key: '[redacted]',
		request: { data: { otp: '[redacted]', recovery_codes: '[redacted]', mfaCode: '[redacted]' } },
		'request.data.otp': '[redacted]',
		'http.request.header.authorization': '[redacted]',
		deep: [{ list: [{ Password: '[redacted]' }] }]
	})
})

test('JSON bodies are filtered as JSON even when values contain =', () => {
	const body = JSON.stringify({
		content: 'v=spf1 a=b ~all',
		password: 'hunter2',
		note: 'a=b&c="d"',
		link: 'https://x.test/?token=abc'
	})
	// Still valid JSON afterwards, with values that merely contain = left as they were.
	const cleaned = JSON.parse(scrubString(body))
	assert.equal(cleaned.content, 'v=spf1 a=b ~all')
	assert.equal(cleaned.note, 'a=b&c="d"')
	assert.equal(cleaned.password, '[redacted]')
	assert.equal(cleaned.link, 'https://x.test/?token=[redacted]')
	assert.equal(scrubString('password=hunter2&name=www'), 'password=[redacted]&name=www')
})

test('query-string secrets are removed from span attributes and breadcrumbs', () => {
	const span = sanitizeSentrySpan({
		op: 'http.client',
		description: 'GET https://example.com/cb?code=oauth123&state=st4te&page=2',
		data: {
			'url.query': 'token=abc123&zone=023e105f4ecef8ad9ca31a8372d0c353',
			'url.full': 'https://example.com/x?X-Amz-Signature=deadbeef&key=docs/a.pdf'
		}
	})
	assert.equal(span.data['url.query'], 'token=[redacted]&zone=023e105f4ecef8ad9ca31a8372d0c353')
	assert.equal(span.data['url.full'], 'https://example.com/x?X-Amz-Signature=[redacted]&key=docs/a.pdf')
	assert.equal(span.description, 'GET https://example.com/cb?code=[redacted]&state=[redacted]&page=2')
	const options = sentryOptions({ dsn: DEFAULT_SENTRY_DSN, environment: 'production', runtime: 'browser' })
	const crumb = options.beforeBreadcrumb({
		category: 'fetch',
		data: { url: '/api/shares/accept?token=abc123&x=1', method: 'POST' },
		message: 'GET /reset?otp=482913'
	})
	assert.equal(crumb.data.url, '/api/shares/accept?token=[redacted]&x=1')
	assert.equal(crumb.message, 'GET /reset?otp=[redacted]')
	assert.equal(crumb.data.method, 'POST')
})

test('database driver errors lose their bound parameters', () => {
	const safe = sanitizeSentryEvent({
		exception: {
			values: [{ type: 'Error', value: 'insert into users failed, parameters: ["ben", "hunter2"]' }]
		},
		extra: { query: 'insert into users (username, password_hash) values (?, ?)', parameters: ['ben', 'h'] },
		contexts: { db: { bindings: ['ben', 'h'], params: ['ben', 'h'] } }
	})
	assert.equal(safe.exception.values[0].value, 'insert into users failed, parameters: [redacted]')
	assert.equal(safe.extra.parameters, '[redacted]')
	assert.equal(safe.extra.query, 'insert into users (username, password_hash) values (?, ?)')
	assert.equal(safe.contexts.db.bindings, '[redacted]')
	assert.equal(safe.contexts.db.params, '[redacted]')
})

test('cut-short bodies and percent-encoded names still lose their secrets', () => {
	// The SDK truncates captured bodies, which can end inside a secret value.
	const cut = '{"username":"ben","current":"correct horse batt'
	assert.equal(scrubString(cut), '{"username":"ben","current":"[redacted]"')
	assert.equal(scrubString('Error: password="correct horse batt'), 'Error: password=[redacted]')
	assert.equal(scrubString('/reset?%6ftp=482913&page=2'), '/reset?%6ftp=[redacted]&page=2')
	assert.equal(scrubString('/x?api%2Dkey=k1&access%5Ftoken=t1'), '/x?api%2Dkey=[redacted]&access%5Ftoken=[redacted]')
	assert.equal(scrubString('/x?zone%5Bid%5D=abc'), '/x?zone%5Bid%5D=abc')
})

// A Worker secret set from the Console: the value goes in --text (or --key-base64 for key
// material), or straight in the JSON body, and none of those names looks like a secret.
const WORKER_SECRET = 'sk_live_51HxWorkerSecretValue'
const KEY_MATERIAL = 'MC4CAQAwBQYDK2VwBCIEIKeyMaterialBase64Value'
const catalogue = JSON.parse(readFileSync(new URL('../server/cf/catalogue.json', import.meta.url), 'utf8'))
const secretsUpdate = catalogue.commands.find((command) => command.command === 'workers secrets update')
const consoleInput = () => ({
	command: 'workers secrets update',
	account: '023e105f4ecef8ad9ca31a8372d0c353',
	args: { name: 'STRIPE_KEY' },
	flags: { worker: 'billing-api', text: WORKER_SECRET, 'key-base64': KEY_MATERIAL, format: 'raw', usages: 'sign' },
	body: { name: 'STRIPE_KEY', text: WORKER_SECRET, key_base64: KEY_MATERIAL, type: 'secret_text' }
})

function assertNoWorkerSecret(value) {
	const json = JSON.stringify(value)
	assert.ok(!json.includes(WORKER_SECRET), `Worker secret leaked: ${json}`)
	assert.ok(!json.includes(KEY_MATERIAL), `key material leaked: ${json}`)
}

test('Console runs record the command and non-secret inputs, never flag or body values', () => {
	assert.ok(secretsUpdate, 'the catalogue has workers secrets update')
	const facts = consoleRunFacts(secretsUpdate, consoleInput())
	assertNoWorkerSecret(facts)
	assert.equal(facts.command, 'workers secrets update')
	assert.equal(facts.method, 'PUT')
	assert.equal(facts.account, '023e105f4ecef8ad9ca31a8372d0c353')
	// --worker goes in the URL path, so its value is kept; body flags are named only.
	assert.equal(facts.flags.worker, 'billing-api')
	assert.equal(facts.flags.text, '[not collected]')
	assert.equal(facts.flags['key-base64'], '[not collected]')
	assert.equal(facts.flags.format, '[not collected]')
	assert.equal(facts.args.name, '[not collected]')
	assert.equal(facts.body, '[not collected]')
	assert.deepEqual(facts.bodyFields, ['name', 'text', 'key_base64', 'type'])
	// Flags the catalogue doesn't describe are treated as body inputs.
	const unknown = consoleRunFacts(secretsUpdate, { flags: { 'made-up': WORKER_SECRET } })
	assert.equal(unknown.flags['made-up'], '[not collected]')
})

test('request bodies are collected only on routes without credentials', () => {
	for (const url of [
		'/api/cf/run',
		'https://dns.brth.dev/api/cf/run?x=1',
		'/api/cf/run/',
		'/api/auth/login',
		'/api/auth/password',
		'/api/connections/add',
		'/api/token_setup',
		'/api/shares/accept',
		'/api/create_skip_rule',
		'/api/update_rule',
		'/api/r2_upload',
		'/api/ai_dns_editor/plan',
		'/api/some_new_route',
		'',
		undefined
	]) {
		assert.equal(collectsRequestBody(url), false, String(url))
	}
	for (const url of ['/api/create_record', 'https://dns.brth.dev/api/update_record', '/api/shares/save']) {
		assert.equal(collectsRequestBody(url), true, url)
	}
	const sdkHttp = sentryOptions({
		dsn: DEFAULT_SENTRY_DSN,
		environment: 'production',
		runtime: 'server',
		http: { name: 'Http', marker: true }
	}).integrations([{ name: 'Http' }, { name: 'Console' }])
	assert.deepEqual(sdkHttp, [{ name: 'Console' }, { name: 'Http', marker: true }])
})

test('events from Console runs lose the request body in flag or body form', () => {
	for (const data of [JSON.stringify(consoleInput()), consoleInput(), `flags[text]=${WORKER_SECRET}`]) {
		const safe = sanitizeSentryEvent({
			request: { url: 'https://dns.brth.dev/api/cf/run', method: 'POST', data },
			contexts: { console: consoleRunFacts(secretsUpdate, consoleInput()) },
			exception: { values: [{ type: 'Error', value: 'Couldn’t reach Cloudflare' }] }
		})
		assertNoWorkerSecret(safe)
		assert.equal(safe.request.data, undefined)
		assert.equal(safe.request.method, 'POST')
		assert.equal(safe.contexts.console.command, 'workers secrets update')
		assert.equal(safe.contexts.console.flags.worker, 'billing-api')
	}
	// Bodies on allowed routes are still kept.
	const kept = sanitizeSentryEvent({
		request: { url: '/api/create_record', data: { dns: { name: 'www.example.com', content: 'v=spf1 ~all' } } }
	})
	assert.equal(kept.request.data.dns.content, 'v=spf1 ~all')
})

test('the installed SDK never reads a Console request body', async () => {
	const envelopes = []
	Sentry.init({
		...sentryOptions({
			dsn: DEFAULT_SENTRY_DSN,
			environment: 'production',
			runtime: 'server',
			host: 'web-1',
			http: Sentry.httpIntegration({ ignoreRequestBody: (url) => !collectsRequestBody(url) })
		}),
		transport: () => ({
			send: async (envelope) => {
				envelopes.push(envelope)
				return { statusCode: 200 }
			},
			flush: async () => true
		})
	})
	// Reads the body the way h3 does, then fails inside the request's own async context.
	const server = createServer(async (request, response) => {
		const text = await new Promise((resolve) => {
			let body = ''
			request.on('data', (chunk) => (body += chunk))
			request.on('end', () => resolve(body))
		})
		Sentry.captureException(new Error(`failed ${request.url} (${text.length} bytes)`))
		response.end('{}')
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const base = `http://127.0.0.1:${server.address().port}`
	try {
		for (const body of [
			{ ...consoleInput(), body: undefined },
			{ ...consoleInput(), flags: { worker: 'x' } }
		]) {
			await fetch(`${base}/api/cf/run`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			})
		}
		await fetch(`${base}/api/create_record`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ dns: { name: 'www.example.com' } })
		})
	} finally {
		await new Promise((resolve) => server.close(resolve))
	}
	assert.equal(await Sentry.flush(2000), true)
	await Sentry.close(2000)
	assertNoWorkerSecret(envelopes)
	const events = envelopes.flatMap(([, items]) => items).filter(([header]) => header.type === 'event')
	const byPath = (path) => events.filter(([, event]) => event.request?.url?.includes(path)).map(([, event]) => event)
	assert.equal(byPath('/api/cf/run').length, 2)
	for (const event of byPath('/api/cf/run')) assert.equal(event.request.data, undefined)
	// The allowlisted route still has its body, which shows capture itself is working.
	assert.match(JSON.stringify(byPath('/api/create_record')[0].request.data), /www\.example\.com/)
})
