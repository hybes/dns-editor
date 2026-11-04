import { readJsonBody } from '../../utils/readJsonBody'
import { acceptInvite } from '../../utils/shares'
import { forgetRenewals } from '../../utils/renewals'
import { log } from '../../../shared/utils/log'

// Accepts an invite link for the signed-in account. Body: { token }.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	const result = acceptInvite(body.token, event.context.user.id)
	forgetRenewals()
	log.info(
		'sharing',
		`${event.context.user.username} accepted ${result.owner}’s invite to ${result.zoneCount} domains`,
		{
			userId: event.context.user.id,
			username: event.context.user.username,
			owner: result.owner,
			zoneCount: result.zoneCount
		}
	)
	return { success: true, errors: [], messages: [], result }
})
