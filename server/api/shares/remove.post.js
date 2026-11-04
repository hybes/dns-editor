import { readJsonBody } from '../../utils/readJsonBody'
import { deleteShare } from '../../utils/shares'
import { forgetRenewals } from '../../utils/renewals'
import { log } from '../../../shared/utils/log'

// Ends a share: the person loses access to its domains at once. Body: { id }.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	deleteShare(event.context.user.id, Number(body.id))
	forgetRenewals()
	log.info('sharing', `${event.context.user.username} removed share ${Number(body.id)}`, {
		userId: event.context.user.id,
		username: event.context.user.username,
		shareId: Number(body.id)
	})
	return { success: true, errors: [], messages: [], result: null }
})
