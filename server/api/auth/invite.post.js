import { readJsonBody } from '../../utils/readJsonBody'
import { inviteInfo } from '../../utils/shares'
import { clientIp, limitAttempts } from '../../utils/rateLimit'

// Who an invite link is from and how many domains it shares, so the invite page can say so
// before the person signs in or creates an account. Body: { token }.
export default defineEventHandler(async (event) => {
	limitAttempts(`invite:${clientIp(event)}`, { limit: 60, windowMs: 15 * 60_000 })
	const body = await readJsonBody(event)
	return { success: true, errors: [], messages: [], result: inviteInfo(body.token) }
})
