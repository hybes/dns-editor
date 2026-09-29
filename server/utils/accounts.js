import { createError } from 'h3'
import { useDb } from './db'
import { decoyPasswordHash, hashPassword, verifyPassword } from './secrets'

// DNS Manager's own accounts: a username and a password (stored as an scrypt hash).

const USERNAME = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/i
const MIN_PASSWORD = 10
const MAX_PASSWORD = 200

const badRequest = (statusMessage) => createError({ statusCode: 400, message: statusMessage })

export function readUsername(value) {
	const username = typeof value === 'string' ? value.trim() : ''
	if (!USERNAME.test(username)) {
		throw badRequest(
			'Usernames are 3 to 32 letters, numbers, dots, hyphens or underscores, starting and ending with a letter or number.'
		)
	}
	return username
}

export function readNewPassword(value) {
	const password = typeof value === 'string' ? value : ''
	if (password.length < MIN_PASSWORD) throw badRequest(`Use a password of at least ${MIN_PASSWORD} characters.`)
	if (password.length > MAX_PASSWORD) throw badRequest(`Use a password of at most ${MAX_PASSWORD} characters.`)
	return password
}

export async function createUser(username, password) {
	const db = useDb()
	if (db.prepare('select 1 from users where username = ?').get(username)) {
		throw createError({ statusCode: 409, message: 'That username is taken. Choose another.' })
	}
	const { lastInsertRowid } = db
		.prepare('insert into users (username, password_hash) values (?, ?)')
		.run(username, await hashPassword(password))
	return { id: Number(lastInsertRowid), username }
}

// Resolves to the user, or null when the username or password is wrong. Takes as long either
// way, so a failed sign-in doesn't show whether the username exists.
export async function checkPassword(username, password) {
	const row = useDb()
		.prepare('select id, username, password_hash from users where username = ? and disabled_at is null')
		.get(username)
	const ok = await verifyPassword(password, row?.password_hash || (await decoyPasswordHash()))
	return row && ok ? { id: row.id, username: row.username } : null
}

export async function setPassword(userId, password) {
	useDb()
		.prepare('update users set password_hash = ? where id = ?')
		.run(await hashPassword(password), userId)
}
