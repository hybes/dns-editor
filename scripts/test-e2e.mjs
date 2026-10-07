#!/usr/bin/env node
// End-to-end checks of accounts, connections and sharing against the built server
// (.output, from `npm run build`) and a stand-in Cloudflare API, so nothing reaches Cloudflare.
// Two people sign up; the owner connects a Cloudflare token and shares one domain; the checks
// then make sure the other person can do exactly what they were given, and nothing more.
//
//   npm run build && npm run test:e2e

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_PORT = 3997
const CF_PORT = 3998
const APP = `http://127.0.0.1:${APP_PORT}`
const OWNER_TOKEN = 'owner-token-0123456789abcdefghij'
const SETUP_TOKEN = 'setup-token-0123456789abcdefghij'
const MADE_TOKEN = 'made-token-0123456789abcdefghijk'
const ACCOUNT = 'a'.repeat(32)
const OTHER_ACCOUNT = 'c'.repeat(32)
const Z1 = '1'.repeat(32)
const Z2 = '2'.repeat(32)
const Z3 = '3'.repeat(32)
const Z4 = '4'.repeat(32)
const BUCKET = `dm-${Z1}`
const RECORD = 'f'.repeat(32)

if (!existsSync('.output/server/index.mjs')) {
	console.error('Build the app first: npm run build')
	process.exit(1)
}

// --- A stand-in Cloudflare ------------------------------------------------------------------

const zones = [
	{ id: Z1, name: 'example.com', status: 'active', account: { id: ACCOUNT, name: 'Owner' }, plan: { name: 'Free' } },
	{ id: Z2, name: 'private.com', status: 'active', account: { id: ACCOUNT, name: 'Owner' }, plan: { name: 'Free' } },
	{ id: Z3, name: 'shop-demo.com', status: 'active', account: { id: ACCOUNT, name: 'Owner' } },
	{ id: Z4, name: 'shop--demo.com', status: 'active', account: { id: ACCOUNT, name: 'Owner' } }
]
const tokens = {
	[OWNER_TOKEN]: { id: 'tok-owner', zones: [Z1, Z2, Z3, Z4] },
	[MADE_TOKEN]: { id: 'tok-made', zones: [Z1, Z2, Z3, Z4] },
	[SETUP_TOKEN]: { id: 'tok-setup', zones: [], maker: true }
}
const seen = []
let rejectMadeToken = false
let failSetupDeletion = false
let registrarReadOnly = false
const buckets = new Set([BUCKET, 'shop-demo-com'])
const permissionGroups = [
	...[
		'Zone Read',
		'DNS Write',
		'Zone Settings Write',
		'Analytics Read',
		'Zone WAF Write',
		'Dynamic URL Redirects Write',
		'Origin Write',
		'Config Settings Write',
		'Zone Transform Rules Write',
		'Cache Settings Write',
		'Custom Errors Write',
		'Response Compression Write',
		'Bot Management Write'
	].map((name) => ({ name, scopes: ['com.cloudflare.api.account.zone'] })),
	...[
		'Account Settings Write',
		'Account Analytics Read',
		'Workers R2 Storage Write',
		'Billing Read',
		'Turnstile Write',
		'DNS Firewall Write',
		'DNS Views Write',
		'Registrar Write'
	].map((name) => ({ name, scopes: ['com.cloudflare.api.account'] }))
].map((group, index) => ({ ...group, id: `group-${index}` }))

const send = (res, status, body) => {
	res.writeHead(status, { 'content-type': 'application/json' })
	res.end(JSON.stringify(body))
}
const ok = (res, result, extra = {}) => send(res, 200, { success: true, errors: [], messages: [], result, ...extra })
const refuse = (res, code = 10000, message = 'Authentication error') =>
	send(res, 403, { success: false, errors: [{ code, message }], messages: [], result: null })

const cloudflare = createServer((req, res) => {
	let raw = ''
	req.on('data', (chunk) => (raw += chunk))
	req.on('end', () => {
		const url = new URL(req.url, 'http://x')
		const path = url.pathname.replace('/client/v4', '')
		const token = String(req.headers.authorization || '').replace('Bearer ', '')
		const who = tokens[token]
		let requestBody
		try {
			requestBody = JSON.parse(raw || '{}')
		} catch {
			requestBody = raw
		}
		seen.push({ method: req.method, path, token, body: requestBody })
		if (!who) return send(res, 401, { success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] })
		const canSee = (zoneId) => who.zones.includes(zoneId)
		let match
		if (path === '/user/tokens/verify') return ok(res, { id: who.id, status: 'active' })
		if (path === '/user/tokens/permission_groups') {
			if (!who.maker) return refuse(res)
			return ok(res, [
				...permissionGroups.map((group) =>
					registrarReadOnly && group.name === 'Registrar Write' ? { ...group, name: 'Registrar Read' } : group
				),
				{ id: 'sandbox-only', name: 'Registrar Sandbox Write', scopes: ['com.cloudflare.api.account'] }
			])
		}
		if (path === '/user/tokens' && req.method === 'POST')
			return who.maker ? ok(res, { id: 'tok-made', value: MADE_TOKEN }) : refuse(res)
		if ((match = path.match(/^\/user\/tokens\/([\w-]+)$/)) && req.method === 'DELETE') {
			if (failSetupDeletion && match[1] === 'tok-setup') return refuse(res)
			return ok(res, { id: match[1] })
		}
		if (path === '/zones') {
			if (rejectMadeToken && token === MADE_TOKEN) return refuse(res)
			const name = url.searchParams.get('name')
			const list = zones.filter((zone) => canSee(zone.id) && (!name || zone.name === name))
			return ok(res, list, { result_info: { page: 1, total_pages: 1, count: list.length } })
		}
		if (path === '/accounts')
			return ok(res, who.zones.length ? [{ id: ACCOUNT, name: 'Owner' }] : [], {
				result_info: { total_pages: 1 }
			})
		if ((match = path.match(/^\/zones\/(\w+)$/))) {
			return canSee(match[1])
				? ok(
						res,
						zones.find((zone) => zone.id === match[1])
					)
				: refuse(res, 7003, 'Could not route')
		}
		if ((match = path.match(/^\/zones\/(\w+)\/dns_records(?:\/(\w+))?$/))) {
			if (!canSee(match[1])) return refuse(res)
			if (req.method === 'GET')
				return ok(res, [{ id: RECORD, type: 'A', name: 'example.com', content: '192.0.2.1' }], {
					result_info: { total_pages: 1 }
				})
			if (req.method === 'POST') return ok(res, { id: 'e'.repeat(32), ...JSON.parse(raw || '{}') })
			if (req.method === 'DELETE') return ok(res, { id: match[2] })
		}

		if (path === `/zones/${Z1}/dns_records/batch`) return ok(res, requestBody)
		if (path === `/zones/${Z1}/rulesets`) return token === MADE_TOKEN ? ok(res, []) : refuse(res)
		if (path === '/graphql') {
			const query = requestBody.query || ''
			if (query.includes('zones('))
				return send(res, 200, {
					data: { viewer: { zones: [{ settings: { dnsAnalyticsAdaptiveGroups: { enabled: false } } }] } }
				})
			if (query.includes('settings'))
				return send(res, 200, {
					data: { viewer: { accounts: [{ settings: { dnsAnalyticsAdaptiveGroups: { enabled: true } } }] } }
				})
			return send(res, 200, {
				data: {
					viewer: { accounts: [{ total: [{ count: 12345 }], series: [], queryTypes: [], responseCodes: [] }] }
				}
			})
		}
		if ((match = path.match(/^\/accounts\/(\w+)\//))) {
			if (match[1] !== ACCOUNT || !who.zones.length) return refuse(res)
			if (path.endsWith('/registrar/registrations')) {
				if (req.method === 'POST')
					return token === MADE_TOKEN ? ok(res, { state: 'succeeded', completed: true }) : refuse(res)
				return ok(
					res,
					[
						{
							domain_name: 'example.com',
							status: 'active',
							auto_renew: false,
							expires_at: '2027-01-01T00:00:00Z'
						}
					],
					{ result_info: { cursor: '' } }
				)
			}
			if (path.endsWith('/registrar/registrations/example.com')) {
				if (req.method === 'GET')
					return ok(res, {
						domain_name: 'example.com',
						status: 'active',
						auto_renew: false,
						expires_at: '2027-01-01T00:00:00Z'
					})
				return ok(res, { state: 'succeeded', completed: true })
			}
			if (path.endsWith('/registrar/domain-check')) {
				const names = JSON.parse(raw || '{}').domains || []
				return ok(res, {
					domains: names.map((name) => ({
						name,
						registrable: true,
						tier: 'standard',
						pricing: { currency: 'USD', registration_cost: '10.44', renewal_cost: '10.44' }
					}))
				})
			}

			if (path.endsWith('/r2/buckets') && req.method === 'POST') {
				buckets.add(requestBody.name)
				return ok(res, { name: requestBody.name })
			}
			if (path.includes('/r2/buckets/')) {
				const name = path.split('/r2/buckets/')[1].split('/')[0]
				if (!buckets.has(name)) return refuse(res, 10006, 'The specified bucket does not exist')
				return ok(res, [], { result_info: { cursor: '', delimited: [] } })
			}
			if (path.endsWith('/challenges/widgets')) return ok(res, [], { result_info: { total_pages: 1 } })
		}
		return send(res, 404, {
			success: false,
			errors: [{ code: 7003, message: `No route for ${req.method} ${path}` }]
		})
	})
})

// --- The app ----------------------------------------------------------------------------------

const dataDir = mkdtempSync(join(tmpdir(), 'dns-manager-e2e-'))
let app
const stop = () => {
	app?.kill()
	cloudflare.close()
	rmSync(dataDir, { recursive: true, force: true })
}

const results = []
const check = (label, pass, detail = '') => {
	results.push(pass)
	console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${!pass && detail ? ` (${detail})` : ''}`)
}

// A browser: its own cookie jar, and the app's origin on every request.
const client = () => {
	let cookie = ''
	return async (path, body = {}, headers = {}) => {
		const response = await fetch(`${APP}/api/${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: APP, ...(cookie && { cookie }), ...headers },
			body: JSON.stringify(body)
		})
		const set = response.headers.get('set-cookie')
		if (set) cookie = set.split(';')[0]
		const text = await response.text()
		let json = null
		try {
			json = JSON.parse(text)
		} catch {
			// Not JSON.
		}
		return { status: response.status, json, text }
	}
}

try {
	await new Promise((resolve) => cloudflare.listen(CF_PORT, '127.0.0.1', resolve))
	app = spawn('node', ['.output/server/index.mjs'], {
		env: {
			...process.env,
			PORT: String(APP_PORT),
			HOST: '127.0.0.1',
			NUXT_DATA_DIR: dataDir,
			NUXT_TOKEN_KEY: randomBytes(32).toString('base64'),
			CLOUDFLARE_API_BASE: `http://127.0.0.1:${CF_PORT}/client/v4`
		},
		stdio: ['ignore', 'ignore', 'pipe']
	})
	app.stderr.on('data', (chunk) => {
		const text = String(chunk)
		if (!/ExperimentalWarning|trace-warnings/.test(text)) process.stderr.write(text)
	})
	for (let attempt = 0; attempt < 50; attempt++) {
		const up = await fetch(`${APP}/api/health`)
			.then((r) => r.ok)
			.catch(() => false)
		if (up) break
		await new Promise((resolve) => setTimeout(resolve, 200))
	}

	const owner = client()
	const mate = client()
	const outsider = client()
	const everyBody = []
	const call = async (who, path, body) => {
		const response = await who(path, body)
		everyBody.push(response.text)
		return response
	}

	// Accounts and connections
	check('health check answers', (await fetch(`${APP}/api/health`)).ok)
	check('signed out is refused', (await call(owner, 'zones')).status === 401)
	check(
		'owner signs up',
		(await call(owner, 'auth/signup', { username: 'ben', password: 'owner password 123' })).json?.success
	)
	check(
		'username is unique',
		(await call(mate, 'auth/signup', { username: 'BEN', password: 'another password 1' })).status === 409
	)
	const badName = await call(mate, 'auth/signup', { username: 'x', password: 'another password 1' })
	check(
		'error messages reach the browser',
		badName.status === 400 && /^Usernames are/.test(badName.json?.message || ''),
		badName.text.slice(0, 120)
	)
	check(
		'friend signs up',
		(await call(mate, 'auth/signup', { username: 'adam', password: 'friend password 12' })).json?.success
	)
	check(
		'outsider signs up',
		(await call(outsider, 'auth/signup', { username: 'eve', password: 'outsider password' })).json?.success
	)
	check(
		'a bad token isn’t added',
		(await call(owner, 'connections/add', { token: 'nope-nope-nope' })).json?.reason === 'invalid'
	)
	check('owner adds a connection', (await call(owner, 'connections/add', { token: OWNER_TOKEN })).json?.success)
	const ownerZones = (await call(owner, 'zones')).json?.result || []
	check('owner sees all zones', ownerZones.length === 4, ownerZones.map((zone) => zone.name).join(','))
	check('friend sees no zones yet', ((await call(mate, 'zones')).json?.result || []).length === 0)
	check('friend can’t read the owner’s zone', (await call(mate, 'records', { currZone: Z1 })).status >= 400)
	check('connections are per account', ((await call(mate, 'connections/list')).json?.result || []).length === 0)

	const preview = await call(outsider, 'token_setup', { token: SETUP_TOKEN, action: 'preview' })
	check(
		'automatic setup resolves every documented app permission',
		preview.json?.result?.app?.missing?.length === 0 &&
			preview.json.result.app.permissions.length === permissionGroups.length
	)
	registrarReadOnly = true
	const partial = await call(outsider, 'token_setup', { token: SETUP_TOKEN, action: 'preview' })
	check(
		'Registrar Sandbox write does not stand in for Registrar write',
		partial.json?.result?.app?.missing?.some((item) => item.name === 'Registrar') &&
			!partial.json.result.app.permissions.some((item) => item.name === 'Registrar Sandbox Write')
	)
	registrarReadOnly = false

	// The set-up token route makes a connection without sending the new token to the browser
	const setup = await call(outsider, 'token_setup', { token: SETUP_TOKEN, action: 'create', coverage: 'app' })
	check('set-up token makes a connection', setup.json?.result?.connection?.id > 0, setup.text.slice(0, 120))
	check('the made token never reaches the browser', !setup.text.includes(MADE_TOKEN))
	await call(outsider, 'connections/remove', { id: setup.json?.result?.connection?.id })
	const policy = seen.find((item) => item.path === '/user/tokens' && item.method === 'POST')?.body?.policies
	check(
		'created token includes all permission IDs in their resource scopes',
		policy?.length === 2 &&
			policy.every((item) =>
				item.permission_groups.every(({ id }) =>
					permissionGroups.some((group) => group.id === id && item.resources[`${group.scopes[0]}.*`] === '*')
				)
			) &&
			policy.flatMap((item) => item.permission_groups).length === permissionGroups.length
	)
	rejectMadeToken = true
	seen.length = 0
	const failedSetup = await call(outsider, 'token_setup', { token: SETUP_TOKEN, action: 'create', coverage: 'app' })
	check('failed token verification is reported as failure', failedSetup.json?.reason === 'verification_failed')
	check('an unverified token is not saved', (await call(outsider, 'connections/list')).json?.result?.length === 0)
	check(
		'failed setup removes the child and keeps the setup token',
		seen.some((item) => item.method === 'DELETE' && item.path === '/user/tokens/tok-made') &&
			!seen.some((item) => item.method === 'DELETE' && item.path === '/user/tokens/tok-setup')
	)
	rejectMadeToken = false

	// Sharing one domain
	const saved = await call(owner, 'shares/save', {
		label: 'Adam',
		defaults: { records: 'view', analytics: 'view', files: 'none', renewals: 'view' },
		showPrices: false,
		zones: [{ id: Z1, overrides: { records: 'edit' }, price: { amount: '20', currency: 'GBP' } }]
	})
	const invite = saved.json?.result?.inviteToken
	check('owner shares a domain', Boolean(invite), saved.text.slice(0, 160))
	check(
		'only the owner’s own zones can be shared',
		(await call(outsider, 'shares/save', { label: 'x', zones: [{ id: Z1 }] })).status === 400
	)
	check(
		'invite says who it’s from',
		(await call(mate, 'auth/invite', { token: invite })).json?.result?.owner === 'ben'
	)
	check('owner can’t accept their own invite', (await call(owner, 'shares/accept', { token: invite })).status === 400)
	check('friend accepts', (await call(mate, 'shares/accept', { token: invite })).json?.success)
	check('an invite works once', (await call(outsider, 'shares/accept', { token: invite })).status === 400)

	const mateZones = (await call(mate, 'zones')).json?.result || []
	check(
		'friend sees only the shared zone',
		mateZones.length === 1 && mateZones[0].id === Z1,
		mateZones.map((zone) => zone.name).join(',')
	)
	check('shared zone says who shared it', mateZones[0]?.shared?.owner === 'ben')

	// What the levels allow
	check('friend can list records (view)', (await call(mate, 'records', { currZone: Z1 })).json?.success)
	const created = await call(mate, 'create_record', {
		currZone: Z1,
		dns: { type: 'A', name: 'www', content: '192.0.2.2', ttl: 1, proxied: false }
	})
	check('friend can add a record (edit override)', created.json?.success, created.text.slice(0, 160))
	check(
		'friend can’t delete records (no delete)',
		(await call(mate, 'delete_record', { currZone: Z1, currDnsRecord: RECORD })).status === 403
	)
	check('friend can’t use the unshared zone', (await call(mate, 'records', { currZone: Z2 })).status === 403)
	check(
		'friend can’t change zone settings',
		(await call(mate, 'update_ssl', { currZone: Z1, value: 'full' })).status === 403
	)
	check('friend can’t use account pages', (await call(mate, 'turnstile_widgets', { currZone: Z1 })).status === 403)
	check(
		'command runner: records on the shared zone',
		(await call(mate, 'cf/run', { command: 'dns records list', zone: Z1 })).json?.success
	)
	check(
		'command runner: records on the zone by name',
		(await call(mate, 'cf/run', { command: 'dns records list', zone: 'example.com' })).json?.success
	)
	check(
		'command runner: unshared zone refused',
		(await call(mate, 'cf/run', { command: 'dns records list', zone: Z2 })).status === 403
	)
	check(
		'command runner: account commands refused',
		(await call(mate, 'cf/run', { command: 'accounts list' })).status === 403
	)
	check(
		'command runner: other account commands refused',
		(await call(mate, 'cf/run', { command: 'turnstile widgets list', accountOfZone: Z1 })).status === 403
	)
	check(
		'files refused without files access',
		(
			await call(mate, 'cf/run', {
				command: 'r2 objects list',
				accountOfZone: Z1,
				flags: { 'bucket-name': BUCKET }
			})
		).status === 403
	)
	check(
		'renewal changes refused with view only',
		(
			await call(mate, 'cf/run', {
				command: 'registrar registrations update',
				account: ACCOUNT,
				args: { 'domain-name': 'example.com' },
				flags: { 'auto-renew': true }
			})
		).status === 403
	)

	const capabilities = (await call(mate, 'capabilities', { currZone: Z1 })).json
	check(
		'capabilities say the zone is shared',
		capabilities?.access?.shared === true && capabilities.access.levels.records === 'edit'
	)
	check('capabilities hide account-wide features', capabilities?.result?.turnstile?.available === false)

	// Renewals and the owner's price
	const mateRenewals = (await call(mate, 'renewals')).json?.result
	check(
		'friend sees the renewal date',
		mateRenewals?.registrations?.['example.com']?.expires_at === '2027-01-01T00:00:00Z'
	)
	check(
		'friend sees the owner’s price, not Cloudflare’s',
		mateRenewals?.prices?.['example.com']?.amount === '20.00' &&
			mateRenewals.prices['example.com'].currency === 'GBP'
	)
	check(
		'friend can’t toggle auto-renew with view only',
		mateRenewals?.registrations?.['example.com']?.editable === false
	)
	const ownerRenewals = (await call(owner, 'renewals')).json?.result
	check('owner sees Cloudflare’s price', ownerRenewals?.prices?.['example.com']?.amount === '10.44')

	const batchInputs = [
		{ body: { deletes: [{ id: RECORD }] } },
		{ flags: { deletes: JSON.stringify([{ id: RECORD }]) } },
		{ body: JSON.stringify({ deletes: [{ id: RECORD }] }) }
	]
	for (const [index, input] of batchInputs.entries()) {
		seen.length = 0
		const response = await call(mate, 'cf/run', { command: 'dns records batch', zone: Z1, ...input })
		check(
			`batch deletions require delete access (${index + 1})`,
			response.status === 403 && !seen.some((item) => item.path.endsWith('/dns_records/batch'))
		)
	}
	check(
		'edit access still permits a batch without deletions',
		(
			await call(mate, 'cf/run', {
				command: 'dns records batch',
				zone: Z1,
				body: { deletes: [], posts: [{ type: 'A', name: 'new.example.com', content: '192.0.2.3', ttl: 1 }] }
			})
		).json?.success
	)
	seen.length = 0
	const sharedAnalytics = await call(mate, 'account_analytics', { currZone: Z1, preset: '24h' })
	check(
		'shared analytics never fall back to the whole account',
		sharedAnalytics.json?.success === false &&
			!seen.some((item) => item.path === '/graphql' && item.body.query.includes('accounts('))
	)
	check(
		'owners retain account analytics fallback',
		(await call(owner, 'account_analytics', { currZone: Z1, preset: '24h' })).json?.result?.scope === 'account'
	)
	// Changing the share after it's accepted
	const shareId = saved.json.result.id
	await call(owner, 'shares/save', {
		id: shareId,
		label: 'Adam',
		defaults: { records: 'view', files: 'view', renewals: 'edit' },
		showPrices: true,
		zones: [{ id: Z1 }]
	})
	check(
		'files allowed once given, on the zone’s own bucket',
		(
			await call(mate, 'cf/run', {
				command: 'r2 objects list',
				accountOfZone: Z1,
				flags: { 'bucket-name': BUCKET }
			})
		).json?.success
	)
	check(
		'files refused on another bucket',
		(
			await call(mate, 'cf/run', {
				command: 'r2 objects list',
				accountOfZone: Z1,
				flags: { 'bucket-name': 'private-com' }
			})
		).status === 403
	)
	seen.length = 0
	await call(mate, 'cf/run', {
		command: 'r2 objects list',
		account: OTHER_ACCOUNT,
		accountOfZone: Z1,
		flags: { 'bucket-name': BUCKET }
	})
	check(
		'a smuggled account is ignored',
		seen.some((item) => item.path.startsWith(`/accounts/${ACCOUNT}/r2/`)) &&
			!seen.some((item) => item.path.includes(OTHER_ACCOUNT))
	)
	check(
		'record edits removed with the override',
		(
			await call(mate, 'create_record', {
				currZone: Z1,
				dns: { type: 'A', name: 'x', content: '192.0.2.3', ttl: 1, proxied: false }
			})
		).status === 403
	)
	check(
		'renewal changes allowed with edit',
		(
			await call(mate, 'cf/run', {
				command: 'registrar registrations update',
				account: ACCOUNT,
				args: { 'domain-name': 'example.com' },
				flags: { 'auto-renew': true }
			})
		).json?.success
	)
	check(
		'renewal changes on another domain refused',
		(
			await call(mate, 'cf/run', {
				command: 'registrar registrations update',
				account: ACCOUNT,
				args: { 'domain-name': 'private.com' },
				flags: { 'auto-renew': true }
			})
		).status === 403
	)
	const priced = (await call(mate, 'renewals', { fresh: true })).json?.result
	check(
		'with prices shown and no override, friend sees Cloudflare’s price',
		priced?.prices?.['example.com']?.amount === '10.44'
	)

	// Files are bound to zone IDs; legacy buckets require a single owner-approved association.
	await call(owner, 'shares/save', {
		id: shareId,
		label: 'Adam',
		defaults: { records: 'delete', files: 'edit', rules: 'edit', renewals: 'view' },
		zones: [{ id: Z1 }, { id: Z3 }, { id: Z4 }]
	})
	check(
		'delete access permits batch deletions',
		(await call(mate, 'cf/run', { command: 'dns records batch', zone: Z1, body: { deletes: [{ id: RECORD }] } }))
			.json?.success
	)
	const wholeRuleset = await call(mate, 'cf/run', {
		command: 'rulesets account-rulesets update',
		zone: Z1,
		args: { 'ruleset-id': 'b'.repeat(32) },
		body: { rules: [] }
	})
	check('replacing a whole ruleset requires delete access', wholeRuleset.status === 403)
	const wholePhase = await call(mate, 'cf/run', {
		command: 'rulesets account-rulesets phases update',
		zone: Z1,
		args: { 'ruleset-phase': 'http_request_firewall_custom' },
		body: { rules: [] }
	})
	check('replacing a phase entry point requires delete access', wholePhase.status === 403)
	for (const body of [{ name: 'unrelated-bucket' }, JSON.stringify({ name: 'unrelated-bucket' })]) {
		seen.length = 0
		const denied = await call(mate, 'cf/run', {
			command: 'r2 buckets create',
			accountOfZone: Z1,
			args: { 'bucket-name': BUCKET },
			body
		})
		check(
			'a decoy bucket argument cannot authorise a different request body',
			denied.status === 403 && !seen.some((item) => item.method === 'POST' && item.path.endsWith('/r2/buckets'))
		)
	}
	check(
		'bucket creation by body flags uses the final authorised name',
		(await call(mate, 'cf/run', { command: 'r2 buckets create', accountOfZone: Z1, flags: { name: BUCKET } })).json
			?.success
	)
	const collisionZones = (await call(owner, 'zones')).json.result.filter((zone) => [Z3, Z4].includes(zone.id))
	check(
		'colliding domain slugs get different buckets',
		collisionZones.length === 2 && collisionZones[0].filesBucket !== collisionZones[1].filesBucket
	)
	check(
		'shared users cannot access an unassigned legacy bucket',
		(
			await call(mate, 'cf/run', {
				command: 'r2 objects list',
				accountOfZone: Z3,
				flags: { 'bucket-name': 'shop-demo-com' }
			})
		).status === 403
	)
	check(
		'shared users cannot adopt legacy buckets',
		(await call(mate, 'r2_adopt_bucket', { currZone: Z3, confirm: true })).status === 403
	)
	check('adoption requires confirmation', (await call(owner, 'r2_adopt_bucket', { currZone: Z3 })).status === 400)
	check(
		'owner can connect the existing bucket without moving files',
		(await call(owner, 'r2_adopt_bucket', { currZone: Z3, confirm: true })).json?.success
	)
	check(
		'repeating the association is safe',
		(await call(owner, 'r2_adopt_bucket', { currZone: Z3, confirm: true })).json?.success
	)
	check(
		'a legacy bucket cannot be associated with a second domain',
		(await call(owner, 'r2_adopt_bucket', { currZone: Z4, confirm: true })).status === 409
	)
	check(
		'the linked legacy bucket is readable on its own shared domain',
		(
			await call(mate, 'cf/run', {
				command: 'r2 objects list',
				accountOfZone: Z3,
				flags: { 'bucket-name': 'shop-demo-com' }
			})
		).json?.success
	)
	check(
		'the same bucket stays forbidden on a colliding domain',
		(
			await call(mate, 'cf/run', {
				command: 'r2 objects list',
				accountOfZone: Z4,
				flags: { 'bucket-name': 'shop-demo-com' }
			})
		).status === 403
	)
	check(
		'zone details report the saved association',
		(await call(mate, 'zone', { currZone: Z3 })).json?.result?.filesBucket === 'shop-demo-com'
	)

	seen.length = 0
	check(
		'upload scope cannot be replaced by a JSON file field',
		(await call(mate, `r2_upload?zone=${Z2}&key=fixture.json`, { currZone: Z1 })).status === 403
	)
	check(
		'upload scope cannot be replaced by another query parameter',
		(await call(mate, `r2_upload?currZone=${Z1}&zone=${Z2}&key=fixture.json`, {})).status === 403
	)
	check(
		'denied uploads never reach Cloudflare',
		!seen.some((item) => item.method === 'PUT' && item.path.includes('/r2/'))
	)
	const upload = await call(mate, `r2_upload?zone=${Z3}&key=fixture.json`, { test: true })
	check(
		'JSON files upload to the linked bucket',
		upload.json?.success &&
			seen.some(
				(item) =>
					item.path === `/accounts/${ACCOUNT}/r2/buckets/shop-demo-com/objects/fixture.json` &&
					item.body.test === true
			)
	)

	// A new connection takes priority; choosing an older one is explicit and per user.
	const oldConnection = (await call(owner, 'connections/list')).json.result[0].id
	const registration = {
		account: ACCOUNT,
		domain: 'fixture.example',
		body: { auto_renew: false },
		quote: { currency: 'USD', registration_cost: '10.44', years: 1 }
	}
	check(
		'Registrar write failure is reported even when availability succeeds',
		(await call(owner, 'registrar_register', registration)).json?.success === false
	)

	failSetupDeletion = true
	const upgraded = await call(owner, 'token_setup', { token: SETUP_TOKEN, action: 'create', coverage: 'app' })
	check(
		'setup saves a working connection even if setup-token cleanup fails',
		upgraded.json?.success && upgraded.json.result.setupDeleted === false
	)
	failSetupDeletion = false
	const newConnection = upgraded.json?.result?.connection?.id
	seen.length = 0
	const registered = await call(owner, 'registrar_register', registration)
	check(
		'the new connection is used for Registrar writes',
		registered.json?.result?.state === 'succeeded' &&
			seen.some(
				(item) =>
					item.method === 'POST' &&
					item.path.endsWith('/registrar/registrations') &&
					item.token === MADE_TOKEN
			)
	)

	check(
		'new connection takes priority for zone requests',
		(await call(owner, 'rulesets', { currZone: Z1 })).json?.success
	)
	check(
		'connection order is reflected in the zones list',
		(await call(owner, 'zones')).json?.result?.find((zone) => zone.id === Z1)?.connection?.id === newConnection
	)
	check(
		'another user cannot change connection priority',
		(await call(outsider, 'connections/prefer', { id: oldConnection })).status === 404
	)
	check(
		'an owner can explicitly prefer an existing connection',
		(await call(owner, 'connections/prefer', { id: oldConnection })).json?.success
	)
	check(
		'explicit preference is used for requests',
		(await call(owner, 'rulesets', { currZone: Z1 })).json?.success === false
	)
	await call(owner, 'connections/prefer', { id: newConnection })
	check(
		'switching back restores the capable connection',
		(await call(owner, 'rulesets', { currZone: Z1 })).json?.success
	)
	// Security basics
	check(
		'requests from another site are refused',
		(await owner('zones', {}, { origin: 'https://evil.example' })).status === 403
	)
	const page = await fetch(`${APP}/login`)
	check(
		'pages send security headers',
		page.headers.get('x-frame-options') === 'DENY' && page.headers.get('x-content-type-options') === 'nosniff'
	)
	const huge = await owner('records', { currZone: Z1, filler: 'x'.repeat(26 * 1024 * 1024) })
	check('oversized requests are refused', huge.status === 413, String(huge.status))
	check(
		'no response carries a token',
		!everyBody.some((text) => text.includes(OWNER_TOKEN) || text.includes(MADE_TOKEN))
	)
	const shares = (await call(owner, 'shares/list')).json?.result
	check('owner sees the share as accepted by adam', shares?.owned?.[0]?.member === 'adam')
	check(
		'friend sees what’s shared with them',
		(await call(mate, 'shares/list')).json?.result?.received?.[0]?.owner === 'ben'
	)

	// Ending the share
	await call(owner, 'shares/remove', { id: shareId })
	check('removing the share ends access at once', (await call(mate, 'records', { currZone: Z1 })).status >= 400)
	check(
		'password change needs the current one',
		(await call(owner, 'auth/password', { current: 'wrong', password: 'a brand new password' })).status === 400
	)
	check(
		'password change works',
		(await call(owner, 'auth/password', { current: 'owner password 123', password: 'a brand new password' })).json
			?.success
	)
	await call(owner, 'auth/logout')
	check('signing out ends the session', (await call(owner, 'zones')).status === 401)
	check(
		'the new password works',
		(await call(owner, 'auth/login', { username: 'Ben', password: 'a brand new password' })).json?.success
	)

	// Deleting an account
	check('deleting needs the password', (await call(outsider, 'auth/delete', { password: 'wrong' })).status === 400)
	check('account deletes', (await call(outsider, 'auth/delete', { password: 'outsider password' })).json?.success)
	check(
		'a deleted account can’t sign in',
		(await call(outsider, 'auth/login', { username: 'eve', password: 'outsider password' })).status === 401
	)
} catch (error) {
	check('the run finished', false, error?.stack || String(error))
} finally {
	stop()
}

const failed = results.filter((pass) => !pass).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
