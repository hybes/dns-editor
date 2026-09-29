import { readJsonBody } from '../../utils/readJsonBody'
import { acceptInvite } from '../../utils/shares'
import { forgetRenewals } from '../../utils/renewals'

// Accepts an invite link for the signed-in account. Body: { token }.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	const result = acceptInvite(body.token, event.context.user.id)
	forgetRenewals()
	return { success: true, errors: [], messages: [], result }
})
