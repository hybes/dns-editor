import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { createUser, readNewPassword, readUsername } from '../../utils/accounts'
import { clientIp, limitAttempts } from '../../utils/rateLimit'
import { startSession } from '../../utils/session'

// Creates an account and signs in. Anyone who can reach the site can sign up; each account
// only ever sees the Cloudflare connections it adds itself. Body: { username, password }.
export default defineEventHandler(async (event) => {
	limitAttempts(`signup:${clientIp(event)}`, { limit: 10, windowMs: 60 * 60_000 })
	const body = await readJsonBody(event)
	const username = readUsername(body.username)
	const password = readNewPassword(body.password)
	if (body.confirm !== undefined && body.confirm !== password) {
		throw createError({ statusCode: 400, message: 'The two passwords don’t match.' })
	}
	const user = await createUser(username, password)
	startSession(event, user.id)
	return { success: true, errors: [], messages: [], result: { user } }
})
