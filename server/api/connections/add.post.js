import { readJsonBody } from '../../utils/readJsonBody'
import { addConnection, describeConnection, userConnections } from '../../utils/connections'
import { connectionLabel } from '../../utils/connectionLabel'
import { checkToken, readToken } from '../../utils/tokenCheck'

// Adds a Cloudflare API token to the signed-in account, once Cloudflare accepts it. Body:
// { token, label? }. A token that can only create tokens answers reason "token_maker", and the
// page offers to make DNS Manager's own token with it (token_setup.post.js) instead.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	const token = readToken(body.token)
	const checked = await checkToken(token)
	if (!checked.success) return checked
	const label =
		typeof body.label === 'string' && body.label.trim()
			? body.label.trim().slice(0, 80)
			: await connectionLabel(token)
	const id = addConnection(event.context.user.id, { token, label, cfTokenId: checked.result.id })
	const row = userConnections(event.context.user.id).find((item) => item.id === id)
	return { success: true, errors: [], messages: [], result: describeConnection(row) }
})
