import { createError, getQuery, getRequestHeader, getRequestHost, readBody } from 'h3'
import { refusal } from '../utils/access'
import { findCfCommand } from '../utils/cfCatalogue'
import { ownsZone, tokenFor, userConnections } from '../utils/connections'
import { hasShares, sharedZone } from '../utils/shares'
import { sessionUser } from '../utils/session'

// Every /api request passes through here.
// 1. A request from another site is refused, so a page elsewhere can't act with someone's
//    session. Browsers always send Origin on these.
// 2. Everything except /api/auth needs a signed-in account.
// 3. Routes that talk to Cloudflare get the token of the account's connection that can see the
//    zone or account in the request, as `apiKey` in the JSON body (h3 caches the parsed body, so
//    the route reads the same object) and as event.context.cfToken. Whatever `apiKey` the
//    browser sends is replaced; tokens never come from the browser.
// 4. A zone someone has shared with the account uses the owner's connection, once the levels the
//    owner gave allow the request (server/utils/access.js). Every zone or account field in the
//    request is pinned to that zone, and event.context.access says it's shared.

// Routes that don't use a single connection's token: they don't call Cloudflare, take a token
// the person has just pasted, or add up every connection themselves.
const NO_TOKEN = new Set([
	'/api/accounts',
	'/api/renewals',
	'/api/zones',
	'/api/token_setup',
	'/api/cf/search',
	'/api/cf/browse',
	'/api/cf/command',
	'/api/dns_lookup',
	'/api/dns_propagation',
	'/api/domain_search',
	'/api/domain_endings',
	'/api/ai_dns_editor/status'
])

// Request bodies are read into memory, so anything larger than this is refused before it is.
// Uploads to Files have their own, larger limit (r2_upload.post.js).
const MAX_BODY_BYTES = 25 * 1024 * 1024

const fromThisSite = (event) => {
	const origin = getRequestHeader(event, 'origin')
	if (!origin) return true
	try {
		return new URL(origin).host === getRequestHost(event, { xForwardedHost: true })
	} catch {
		return false
	}
}

export default defineEventHandler(async (event) => {
	const path = event.path.split('?')[0].replace(/\/+$/, '')
	if (!path.startsWith('/api/')) return

	if (event.method !== 'GET' && event.method !== 'HEAD') {
		const length = Number(getRequestHeader(event, 'content-length') || 0)
		if (length > MAX_BODY_BYTES && path !== '/api/r2_upload') {
			throw createError({ statusCode: 413, message: 'That request is too large.' })
		}
		if (!fromThisSite(event)) {
			throw createError({ statusCode: 403, message: 'Requests must come from DNS Manager itself' })
		}
	}

	if (path.startsWith('/api/auth/') || path === '/api/health') return

	const user = sessionUser(event)
	if (!user) {
		throw createError({ statusCode: 401, message: 'Sign in to continue', data: { reason: 'signed_out' } })
	}
	if (NO_TOKEN.has(path) || /^\/api\/(connections|shares)\//.test(path)) return

	let body = null
	// Upload bodies are file bytes, even when the file itself is JSON. Their scope is in the URL.
	if (path !== '/api/r2_upload' && /json/i.test(getRequestHeader(event, 'content-type') || '')) {
		const parsed = await readBody(event)
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed
	}
	const source = body || getQuery(event)
	const pick = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '')
	// Registrar commands name the domain rather than the zone.
	const zone =
		path === '/api/r2_upload'
			? pick(source.zone)
			: pick(source.currZone) ||
				pick(source.zone) ||
				pick(source.accountOfZone) ||
				(path === '/api/cf/run' ? pick(body?.args?.['domain-name']) : '')

	const shared = zone && hasShares(user.id) ? sharedZone(user.id, zone) : null
	if (shared && !(await ownsZone(user.id, zone))) {
		const command = path === '/api/cf/run' ? await findCfCommand(body?.command) : null
		const reason = refusal({ path, command, shared })
		if (reason) throw createError({ statusCode: 403, message: reason, data: { reason: 'not_shared' } })
		const { token } = await tokenFor(shared.ownerId, { zone: shared.zoneId })
		if (body) {
			for (const key of ['currZone', 'zone', 'accountOfZone']) if (body[key]) body[key] = shared.zoneId
			delete body.account
			delete body.connection
			// Account-wide commands allowed on a shared zone (its bucket, its registration) use the
			// zone's own account.
			if (command && command.scope !== 'zone') body.accountOfZone = shared.zoneId
		}
		event.context.access = { shared: true, ...shared }
		event.context.cfToken = token
		if (body) body.apiKey = token
		return
	}

	if (!userConnections(user.id).length && hasShares(user.id)) {
		throw createError({
			statusCode: 403,
			message: 'That domain isn’t shared with you.',
			data: { reason: 'not_shared' }
		})
	}
	const { token, connectionId } = await tokenFor(user.id, {
		zone,
		account: pick(source.account),
		connection: pick(source.connection)
	})
	event.context.access = { shared: false }
	event.context.cfToken = token
	event.context.connectionId = connectionId
	if (body) body.apiKey = token
})
