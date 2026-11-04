import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { checkPassword, readNewPassword, setPassword } from '../../utils/accounts'
import { clientIp, limitAttempts } from '../../utils/rateLimit'
import { endOtherSessions, sessionUser } from '../../utils/session'
import { log } from '../../../shared/utils/log'

// Changes the signed-in account's password and signs out its other sessions.
// Body: { current, password }.
export default defineEventHandler(async (event) => {
	const user = sessionUser(event)
	if (!user) throw createError({ statusCode: 401, message: 'Sign in to continue' })
	limitAttempts(`password:${clientIp(event)}:${user.id}`, { limit: 10, windowMs: 15 * 60_000 })
	const body = await readJsonBody(event)
	const password = readNewPassword(body.password)
	if (!(await checkPassword(user.username, typeof body.current === 'string' ? body.current : ''))) {
		throw createError({ statusCode: 400, message: 'Your current password isn’t right.' })
	}
	await setPassword(user.id, password)
	endOtherSessions(event, user.id)
	log.info('auth', `${user.username} changed their password`, {
		userId: user.id,
		username: user.username,
		ip: clientIp(event)
	})
	return { success: true, errors: [], messages: [], result: null }
})
