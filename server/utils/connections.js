import { createError } from 'h3'
import { listAccounts, listZones } from './cfLists'
import { useDb } from './db'
import { decryptSecret, encryptSecret } from './secrets'

// A connection is one Cloudflare API token an account has added. Tokens are stored encrypted
// and only decrypted on the server, for the request that needs one; the browser never sees them.
// With several connections, each request uses the one that can see the zone or account it's
// about, as worked out from each connection's zone and account lists.

const SCOPE_TTL_MS = 5 * 60_000
// A zone or account none of the lists has (added in Cloudflare a moment ago) lists again, but
// no more than this often, so requests about something that doesn't exist can't keep doing it.
const REFRESH_MS = 30_000
const scopes = globalThis.__dnsManagerScopes || new Map()
if (!globalThis.__dnsManagerScopes) globalThis.__dnsManagerScopes = scopes

const PUBLIC_FIELDS = 'id, label, token_hint, cf_token_id, created_at, checked_at'

export const describeConnection = (row) => ({
	id: row.id,
	label: row.label,
	hint: row.token_hint,
	createdAt: row.created_at,
	checkedAt: row.checked_at
})

export const userConnections = (userId) =>
	useDb()
		.prepare(`select ${PUBLIC_FIELDS} from connections where user_id = ? order by priority desc, id desc`)
		.all(userId)

const tokenOf = (userId, connectionId) => {
	const row = useDb()
		.prepare('select token_enc from connections where id = ? and user_id = ?')
		.get(connectionId, userId)
	return row ? decryptSecret(row.token_enc) : ''
}

// The last four characters, so a person can tell connections apart in Cloudflare's list.
const hintOf = (token) => `…${token.slice(-4)}`

export function addConnection(userId, { token, label, cfTokenId = null }) {
	const db = useDb()
	const existing = db
		.prepare(
			`select ${PUBLIC_FIELDS} from connections where user_id = ? and cf_token_id = ? and cf_token_id is not null`
		)
		.get(userId, cfTokenId)
	if (existing) {
		db.prepare(
			"update connections set token_enc = ?, token_hint = ?, checked_at = datetime('now') where id = ?"
		).run(encryptSecret(token), hintOf(token), existing.id)
		preferConnection(userId, existing.id)
		return existing.id
	}
	const { lastInsertRowid } = db
		.prepare(
			"insert into connections (user_id, label, token_enc, token_hint, cf_token_id, checked_at) values (?, ?, ?, ?, ?, datetime('now'))"
		)
		.run(userId, label, encryptSecret(token), hintOf(token), cfTokenId)
	preferConnection(userId, Number(lastInsertRowid))
	return Number(lastInsertRowid)
}

// A new or explicitly selected connection wins wherever several can see the same resource.
export function preferConnection(userId, connectionId) {
	const { changes } = useDb()
		.prepare(
			'update connections set priority = (select coalesce(max(priority), 0) + 1 from connections where user_id = ?) where id = ? and user_id = ?'
		)
		.run(userId, connectionId, userId)
	forgetScope(userId)
	return changes > 0
}

export function renameConnection(userId, connectionId, label) {
	const { changes } = useDb()
		.prepare('update connections set label = ? where id = ? and user_id = ?')
		.run(label, connectionId, userId)
	return changes > 0
}

export function removeConnection(userId, connectionId) {
	const { changes } = useDb()
		.prepare('delete from connections where id = ? and user_id = ?')
		.run(connectionId, userId)
	forgetScope(userId)
	return changes > 0
}

export const forgetScope = (userId) => scopes.delete(userId)

// Each connection with its token, for routes that add up every connection (the zones and
// accounts lists).
export const connectionsWithTokens = (userId) =>
	userConnections(userId).map((row) => ({ ...describeConnection(row), token: tokenOf(userId, row.id) }))

// Which connection sees which zone (by ID and by name) and which account.
async function scopeOf(userId, { fresh = false } = {}) {
	const cached = scopes.get(userId)
	if (cached && (fresh ? Date.now() - cached.builtAt < REFRESH_MS : cached.expiresAt > Date.now())) return cached
	const zones = new Map()
	const zoneNames = new Map()
	const names = new Map()
	const accounts = new Map()
	for (const connection of connectionsWithTokens(userId)) {
		const [zoneList, accountList] = await Promise.all([
			listZones(connection.token, { fresh }),
			listAccounts(connection.token, { fresh })
		])
		for (const zone of zoneList?.success ? zoneList.result : []) {
			if (zones.has(zone.id)) continue
			zones.set(zone.id, connection.id)
			zoneNames.set(String(zone.name).toLowerCase(), connection.id)
			names.set(zone.id, zone.name)
			if (zone.account?.id && !accounts.has(zone.account.id)) accounts.set(zone.account.id, connection.id)
		}
		for (const account of accountList?.success ? accountList.result : []) {
			if (!accounts.has(account.id)) accounts.set(account.id, connection.id)
		}
	}
	const scope = { zones, zoneNames, names, accounts, builtAt: Date.now(), expiresAt: Date.now() + SCOPE_TTL_MS }
	scopes.set(userId, scope)
	return scope
}

// Zone ID → name for every zone the account's own connections can see, listed afresh.
export async function ownZoneNames(userId) {
	if (!userConnections(userId).length) return new Map()
	return (await scopeOf(userId, { fresh: true })).names
}

// Whether one of the account's own connections can see this zone (an ID or a name).
export async function ownsZone(userId, zone) {
	if (!zone || !userConnections(userId).length) return false
	const key = String(zone)
	const found = (scope) => scope.zones.has(key) || scope.zoneNames.has(key.toLowerCase())
	return found(await scopeOf(userId)) || found(await scopeOf(userId, { fresh: true }))
}

// The token for a request about `zone` (an ID or a name), `account`, or a chosen `connection`.
// Resolves to { token, connectionId }. A zone or account no connection can see uses the first
// connection, so Cloudflare answers with its own error.
export async function tokenFor(userId, { zone, account, connection } = {}) {
	const list = userConnections(userId)
	if (!list.length) {
		throw createError({
			statusCode: 409,
			message: 'Add a Cloudflare connection first',
			data: { reason: 'no_connection' }
		})
	}
	const pick = (id) => ({ token: tokenOf(userId, id), connectionId: id })
	const chosen = Number(connection)
	if (chosen && list.some((row) => row.id === chosen)) return pick(chosen)
	if (list.length === 1 || (!zone && !account)) return pick(list[0].id)

	const find = (scope) => {
		if (zone) {
			const key = String(zone)
			return scope.zones.get(key) || scope.zoneNames.get(key.toLowerCase())
		}
		return scope.accounts.get(String(account))
	}
	const found = find(await scopeOf(userId)) || find(await scopeOf(userId, { fresh: true }))
	return pick(found || list[0].id)
}
