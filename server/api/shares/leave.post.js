import { readJsonBody } from '../../utils/readJsonBody'
import { leaveShare } from '../../utils/shares'
import { forgetRenewals } from '../../utils/renewals'
import { log } from '../../../shared/utils/log'

// Gives up a share someone made with this account. Body: { id }.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	leaveShare(event.context.user.id, Number(body.id))
	forgetRenewals()
	log.info('sharing', `${event.context.user.username} left share ${Number(body.id)}`, {
		userId: event.context.user.id,
		username: event.context.user.username,
		shareId: Number(body.id)
	})
	return { success: true, errors: [], messages: [], result: null }
})
