import { readJsonBody } from '../../utils/readJsonBody'
import { deleteShare } from '../../utils/shares'
import { forgetRenewals } from '../../utils/renewals'

// Ends a share: the person loses access to its domains at once. Body: { id }.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	deleteShare(event.context.user.id, Number(body.id))
	forgetRenewals()
	return { success: true, errors: [], messages: [], result: null }
})
