import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { checkPassword } from '../../utils/accounts'
import { clearAttempts, clientIp, limitAttempts } from '../../utils/rateLimit'
import { startSession } from '../../utils/session'

// Signs in with a username and password. Body: { username, password }. Ten tries per username
// from one address in 15 minutes, and 50 from one address across all usernames.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
	const password = typeof body.password === 'string' ? body.password : ''
	if (!username || !password) {
		throw createError({ statusCode: 400, message: 'Enter your username and password.' })
	}
	const ip = clientIp(event)
	const key = `login:${ip}:${username}`
	limitAttempts(key, { limit: 10, windowMs: 15 * 60_000 })
	limitAttempts(`login:${ip}`, { limit: 50, windowMs: 15 * 60_000 })
	const user = await checkPassword(username, password)
	if (!user) throw createError({ statusCode: 401, message: 'That username and password don’t match.' })
	clearAttempts(key)
	startSession(event, user.id)
	return { success: true, errors: [], messages: [], result: { user } }
})
