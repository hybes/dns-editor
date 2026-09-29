import { readJsonBody } from '../../utils/readJsonBody'
import { leaveShare } from '../../utils/shares'
import { forgetRenewals } from '../../utils/renewals'

// Gives up a share someone made with this account. Body: { id }.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	leaveShare(event.context.user.id, Number(body.id))
	forgetRenewals()
	return { success: true, errors: [], messages: [], result: null }
})
