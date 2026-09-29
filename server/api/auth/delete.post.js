import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { checkPassword } from '../../utils/accounts'
import { useDb } from '../../utils/db'
import { forgetScope } from '../../utils/connections'
import { clientIp, limitAttempts } from '../../utils/rateLimit'
import { forgetRenewals } from '../../utils/renewals'
import { endSession, sessionUser } from '../../utils/session'

// Deletes the signed-in account once its password is confirmed: its connections (and their
// tokens), the shares it made (so those people lose access) and the shares made with it.
// Cloudflare isn't touched; the tokens keep working there until deleted. Body: { password }.
export default defineEventHandler(async (event) => {
	const user = sessionUser(event)
	if (!user) throw createError({ statusCode: 401, message: 'Sign in to continue' })
	limitAttempts(`delete:${clientIp(event)}:${user.id}`, { limit: 10, windowMs: 15 * 60_000 })
	const body = await readJsonBody(event)
	if (!(await checkPassword(user.username, typeof body.password === 'string' ? body.password : ''))) {
		throw createError({ statusCode: 400, message: 'That password isn’t right.' })
	}
	endSession(event)
	useDb().prepare('delete from users where id = ?').run(user.id)
	forgetScope(user.id)
	forgetRenewals()
	return { success: true, errors: [], messages: [], result: null }
})
