import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { checkPassword } from '../../utils/accounts'
import { checkCap, unverifiedNote } from '../../utils/cap'
import { clearAttempts, clientIp, limitAttempts } from '../../utils/rateLimit'
import { startSession } from '../../utils/session'
import { log, logText } from '../../../shared/utils/log'

// Signs in with a username and password. Body: { username, password, capToken }. Ten tries per
// username from one address in 15 minutes, and 50 from one address across all usernames. The Cap
// token is checked after the rate limits and before the password (server/utils/cap.js).
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
	const cap = await checkCap(event, body.capToken, 'sign-in')
	const user = await checkPassword(username, password)
	if (!user) {
		log.warn('auth', logText`failed sign-in for ${username} from ${ip}`, {
			username,
			ip,
			once: key,
			windowMs: 60_000
		})
		throw createError({ statusCode: 401, message: 'That username and password don’t match.' })
	}
	clearAttempts(key)
	startSession(event, user.id)
	log.info('auth', logText`${user.username} signed in from ${ip}${unverifiedNote(cap)}`, {
		userId: user.id,
		username: user.username,
		ip,
		capVerified: cap.verified,
		capReason: cap.reason
	})
	return { success: true, errors: [], messages: [], result: { user } }
})
