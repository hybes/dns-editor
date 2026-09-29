import { deleteCookie, getCookie, getRequestProtocol, setCookie } from 'h3'
import { useDb } from './db'
import { randomId, sha256 } from './secrets'

// Signed-in sessions: a random value in an HttpOnly cookie, stored only as a SHA-256 hash, so
// the database alone can't be used to sign in. Sessions last 30 days from the last visit and
// end at once when the account is disabled or signs out.

const COOKIE = 'dm_session'
const TTL_MS = 30 * 24 * 60 * 60 * 1000
// Extend a session at most once an hour rather than on every request.
const TOUCH_MS = 60 * 60 * 1000

const expiry = () => new Date(Date.now() + TTL_MS).toISOString()

const cookieOptions = (event) => ({
	httpOnly: true,
	sameSite: 'lax',
	path: '/',
	// Secure whenever the page itself is on HTTPS; a plain-HTTP install on a local network still works.
	secure: getRequestProtocol(event, { xForwardedProto: true }) === 'https',
	maxAge: TTL_MS / 1000
})

export function startSession(event, userId) {
	const value = randomId()
	useDb()
		.prepare('insert into sessions (id, user_id, expires_at) values (?, ?, ?)')
		.run(sha256(value), userId, expiry())
	setCookie(event, COOKIE, value, cookieOptions(event))
}

export function endSession(event) {
	const value = getCookie(event, COOKIE)
	if (value) useDb().prepare('delete from sessions where id = ?').run(sha256(value))
	deleteCookie(event, COOKIE, { path: '/' })
}

// The signed-in user for this request, or null. Cached on the event.
export function sessionUser(event) {
	if (event.context.sessionChecked) return event.context.user || null
	event.context.sessionChecked = true
	const value = getCookie(event, COOKIE)
	if (!value) return null
	const db = useDb()
	const row = db
		.prepare(
			`select sessions.id as session_id, sessions.expires_at, sessions.last_seen_at, users.id, users.username
			from sessions join users on users.id = sessions.user_id
			where sessions.id = ? and users.disabled_at is null`
		)
		.get(sha256(value))
	if (!row || Date.parse(row.expires_at) <= Date.now()) {
		if (row) db.prepare('delete from sessions where id = ?').run(row.session_id)
		return null
	}
	if (Date.now() - Date.parse(`${row.last_seen_at}Z`) > TOUCH_MS) {
		db.prepare("update sessions set expires_at = ?, last_seen_at = datetime('now') where id = ?").run(
			expiry(),
			row.session_id
		)
		setCookie(event, COOKIE, value, cookieOptions(event))
	}
	event.context.user = { id: row.id, username: row.username }
	return event.context.user
}

export function endOtherSessions(event, userId) {
	const value = getCookie(event, COOKIE)
	useDb()
		.prepare('delete from sessions where user_id = ? and id != ?')
		.run(userId, value ? sha256(value) : '')
}
