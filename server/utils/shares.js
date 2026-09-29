import { createError } from 'h3'
import { AREAS, LEVELS, cleanLevels, cleanOverrides, effectiveLevels } from '#shared/utils/access'
import { useDb } from './db'
import { randomId, sha256 } from './secrets'

// Sharing zones with another DNS Manager account. The owner picks zones their own connections
// can see, a default level per area, overrides per zone and, for renewals, whether the person
// sees prices and what price to show. The owner's connection does the Cloudflare requests; the
// person never gets a token.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CURRENCY = /^[A-Z]{3}$/
const MAX_ZONES = 500

const notFound = () => createError({ statusCode: 404, message: 'That share doesn’t exist.' })
const badRequest = (statusMessage) => createError({ statusCode: 400, message: statusMessage })
const parse = (text) => {
	try {
		return JSON.parse(text || '{}')
	} catch {
		return {}
	}
}

// A price the owner sets for a zone, or null. Amounts are kept as the string typed, to 2dp.
export function readPrice(value) {
	if (!value || typeof value !== 'object') return null
	const amount = Number(value.amount)
	const currency = String(value.currency || '').toUpperCase()
	if (value.amount === '' || value.amount === null || value.amount === undefined) return null
	if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000)
		throw badRequest('Prices must be a positive amount.')
	if (!CURRENCY.test(currency)) throw badRequest('Choose a currency for each price, such as GBP or USD.')
	return { amount: amount.toFixed(2), currency }
}

// The zones part of a share from what the page sent, keeping only zones the owner can see.
// `ownZones` is a Map of zone ID → zone name from the owner's connections.
export function readShareZones(value, ownZones) {
	const list = Array.isArray(value) ? value : []
	if (list.length > MAX_ZONES) throw badRequest(`A share can hold up to ${MAX_ZONES} domains.`)
	const zones = new Map()
	for (const item of list) {
		const id = typeof item?.id === 'string' ? item.id : ''
		if (!ownZones.has(id)) throw badRequest('Only domains your own connections can see can be shared.')
		zones.set(id, {
			id,
			name: ownZones.get(id),
			overrides: cleanOverrides(item.overrides),
			price: readPrice(item.price)
		})
	}
	return [...zones.values()]
}

const writeZones = (db, shareId, zones) => {
	db.prepare('delete from share_zones where share_id = ?').run(shareId)
	const insert = db.prepare(
		'insert into share_zones (share_id, zone_id, zone_name, overrides, price_amount, price_currency) values (?, ?, ?, ?, ?, ?)'
	)
	for (const zone of zones) {
		insert.run(
			shareId,
			zone.id,
			zone.name,
			JSON.stringify(zone.overrides),
			zone.price?.amount ?? null,
			zone.price?.currency ?? null
		)
	}
}

const newInvite = () => {
	const token = randomId()
	return { token, hash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString() }
}

const inTransaction = (work) => {
	const db = useDb()
	db.exec('begin')
	try {
		const result = work(db)
		db.exec('commit')
		return result
	} catch (error) {
		db.exec('rollback')
		throw error
	}
}

// Resolves to { id, inviteToken }. The invite link is /invite/<inviteToken>.
export function createShare(ownerId, { label, defaults, showPrices, zones }) {
	const invite = newInvite()
	return inTransaction((db) => {
		const { lastInsertRowid } = db
			.prepare(
				'insert into shares (owner_id, label, defaults, show_prices, invite_hash, invite_expires_at) values (?, ?, ?, ?, ?, ?)'
			)
			.run(
				ownerId,
				label,
				JSON.stringify(cleanLevels(defaults)),
				showPrices ? 1 : 0,
				invite.hash,
				invite.expiresAt
			)
		const id = Number(lastInsertRowid)
		writeZones(db, id, zones)
		return { id, inviteToken: invite.token }
	})
}

export function updateShare(ownerId, shareId, { label, defaults, showPrices, zones }) {
	inTransaction((db) => {
		const { changes } = db
			.prepare('update shares set label = ?, defaults = ?, show_prices = ? where id = ? and owner_id = ?')
			.run(label, JSON.stringify(cleanLevels(defaults)), showPrices ? 1 : 0, shareId, ownerId)
		if (!changes) throw notFound()
		writeZones(db, shareId, zones)
	})
}

// A new invite link for a share nobody has accepted yet; the old link stops working.
export function renewInvite(ownerId, shareId) {
	const invite = newInvite()
	const { changes } = useDb()
		.prepare(
			'update shares set invite_hash = ?, invite_expires_at = ? where id = ? and owner_id = ? and member_id is null'
		)
		.run(invite.hash, invite.expiresAt, shareId, ownerId)
	if (!changes) throw notFound()
	return invite.token
}

export function deleteShare(ownerId, shareId) {
	const { changes } = useDb().prepare('delete from shares where id = ? and owner_id = ?').run(shareId, ownerId)
	if (!changes) throw notFound()
}

export function leaveShare(memberId, shareId) {
	const { changes } = useDb().prepare('delete from shares where id = ? and member_id = ?').run(shareId, memberId)
	if (!changes) throw notFound()
}

const zonesOf = (shareId) =>
	useDb()
		.prepare(
			'select zone_id, zone_name, overrides, price_amount, price_currency from share_zones where share_id = ? order by zone_name'
		)
		.all(shareId)
		.map((row) => ({
			id: row.zone_id,
			name: row.zone_name,
			overrides: cleanOverrides(parse(row.overrides)),
			price: row.price_amount ? { amount: row.price_amount, currency: row.price_currency } : null
		}))

// The owner's shares, for the sharing page.
export function ownedShares(ownerId) {
	return useDb()
		.prepare(
			`select shares.*, users.username as member from shares left join users on users.id = shares.member_id
			where owner_id = ? order by shares.label collate nocase`
		)
		.all(ownerId)
		.map((row) => ({
			id: row.id,
			label: row.label,
			member: row.member || null,
			defaults: cleanLevels(parse(row.defaults)),
			showPrices: Boolean(row.show_prices),
			invite: row.member_id
				? null
				: { expiresAt: row.invite_expires_at, expired: Date.parse(row.invite_expires_at) <= Date.now() },
			createdAt: row.created_at,
			acceptedAt: row.accepted_at,
			zones: zonesOf(row.id)
		}))
}

// Shares others have given this account, for the sharing page's "Shared with you".
export function memberShares(memberId) {
	return useDb()
		.prepare(
			`select shares.id, shares.label, users.username as owner, shares.accepted_at,
			(select count(*) from share_zones where share_id = shares.id) as zone_count
			from shares join users on users.id = shares.owner_id where member_id = ? order by owner`
		)
		.all(memberId)
		.map((row) => ({
			id: row.id,
			owner: row.owner,
			zoneCount: Number(row.zone_count),
			acceptedAt: row.accepted_at
		}))
}

const inviteRow = (token) =>
	useDb()
		.prepare(
			`select shares.id, shares.owner_id, shares.invite_expires_at, users.username as owner,
			(select count(*) from share_zones where share_id = shares.id) as zone_count
			from shares join users on users.id = shares.owner_id
			where invite_hash = ? and member_id is null`
		)
		.get(sha256(String(token || '')))

// What an invite link offers, before accepting: who from and how many domains.
export function inviteInfo(token) {
	const row = inviteRow(token)
	if (!row)
		return {
			valid: false,
			reason: 'This invite link isn’t valid. It may have been used already, or replaced by a newer one.'
		}
	if (Date.parse(row.invite_expires_at) <= Date.now()) {
		return { valid: false, reason: `This invite link has expired. Ask ${row.owner} for a new one.` }
	}
	return { valid: true, owner: row.owner, zoneCount: Number(row.zone_count) }
}

export function acceptInvite(token, memberId) {
	const row = inviteRow(token)
	const info = inviteInfo(token)
	if (!row || !info.valid) throw badRequest(info.reason)
	if (row.owner_id === memberId)
		throw badRequest('This is your own invite link. Send it to the person you’re sharing with.')
	useDb()
		.prepare(
			"update shares set member_id = ?, invite_hash = null, invite_expires_at = null, accepted_at = datetime('now') where id = ?"
		)
		.run(memberId, row.id)
	return { owner: info.owner, zoneCount: info.zoneCount }
}

const strongest = (a, b) =>
	Object.fromEntries(
		AREAS.map((area) => [area.key, LEVELS[a[area.key]] >= LEVELS[b[area.key]] ? a[area.key] : b[area.key]])
	)

// Every zone shared with this account, one entry per zone. A zone in two shares gets the higher
// level for each area and the first share's price settings.
export function sharedZones(memberId) {
	const rows = useDb()
		.prepare(
			`select share_zones.*, shares.id as share_id, shares.owner_id, shares.defaults, shares.show_prices, users.username as owner
			from share_zones join shares on shares.id = share_zones.share_id join users on users.id = shares.owner_id
			where shares.member_id = ? and users.disabled_at is null order by share_zones.zone_name`
		)
		.all(memberId)
	const zones = new Map()
	for (const row of rows) {
		const levels = effectiveLevels(parse(row.defaults), parse(row.overrides))
		const existing = zones.get(row.zone_id)
		if (existing) {
			existing.levels = strongest(existing.levels, levels)
			continue
		}
		zones.set(row.zone_id, {
			zoneId: row.zone_id,
			zoneName: row.zone_name,
			shareId: row.share_id,
			ownerId: row.owner_id,
			owner: row.owner,
			levels,
			showPrices: Boolean(row.show_prices),
			price: row.price_amount ? { amount: row.price_amount, currency: row.price_currency } : null
		})
	}
	return [...zones.values()]
}

export const hasShares = (memberId) =>
	Boolean(useDb().prepare('select 1 from shares where member_id = ? limit 1').get(memberId))

// The shared zone with this ID or name, or null.
export function sharedZone(memberId, zone) {
	const key = String(zone || '').toLowerCase()
	if (!key) return null
	return sharedZones(memberId).find((item) => item.zoneId === key || item.zoneName.toLowerCase() === key) || null
}

// Removes invites and sessions that have expired, so the tables don't grow for ever.
export function tidyExpired() {
	const db = useDb()
	db.prepare(
		"delete from shares where member_id is null and invite_expires_at < ? and created_at < datetime('now', '-30 days')"
	).run(new Date().toISOString())
	db.prepare('delete from sessions where expires_at < ?').run(new Date().toISOString())
}
