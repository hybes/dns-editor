import { readJsonBody } from '../../utils/readJsonBody'
import { renewInvite } from '../../utils/shares'

// A new invite link for a share nobody has accepted yet. The previous link stops working.
// Body: { id }.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	const inviteToken = renewInvite(event.context.user.id, Number(body.id))
	return { success: true, errors: [], messages: [], result: { inviteToken } }
})
