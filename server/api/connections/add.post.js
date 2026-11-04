import { readJsonBody } from '../../utils/readJsonBody'
import { addConnection, describeConnection, userConnections } from '../../utils/connections'
import { connectionLabel } from '../../utils/connectionLabel'
import { checkToken, readToken } from '../../utils/tokenCheck'
import { log, logText } from '../../../shared/utils/log'

// Adds a Cloudflare API token to the signed-in account, once Cloudflare accepts it. Body:
// { token, label? }. A token that can only create tokens answers reason "token_maker", and the
// page offers to make DNS Manager's own token with it (token_setup.post.js) instead.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	const token = readToken(body.token)
	const user = event.context.user
	const checked = await checkToken(token)
	if (!checked.success) {
		const level = checked.reason === 'unreachable' ? 'warn' : 'info'
		log[level](
			'connections',
			logText`token from ${user.username} not added (${checked.reason}): ${checked.errors?.[0]?.message}`,
			{
				userId: user.id,
				username: user.username,
				reason: checked.reason
			}
		)
		return checked
	}
	const label =
		typeof body.label === 'string' && body.label.trim()
			? body.label.trim().slice(0, 80)
			: await connectionLabel(token)
	const id = addConnection(event.context.user.id, { token, label, cfTokenId: checked.result.id })
	const row = userConnections(event.context.user.id).find((item) => item.id === id)
	log.info(
		'connections',
		logText`${user.username} added connection ${id} “${label}” (${checked.result.owner} token)`,
		{
			userId: user.id,
			username: user.username,
			connectionId: id,
			label,
			owner: checked.result.owner,
			cfTokenId: checked.result.id,
			expiresOn: checked.result.expires_on
		}
	)
	return { success: true, errors: [], messages: [], result: describeConnection(row) }
})
