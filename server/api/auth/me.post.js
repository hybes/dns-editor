import { describeConnection, userConnections } from '../../utils/connections'
import { memberShares } from '../../utils/shares'
import { sessionUser } from '../../utils/session'

// Who is signed in, with their Cloudflare connections (never the tokens) and how many shares
// others have made with them. { user: null } when nobody is.
export default defineEventHandler((event) => {
	const user = sessionUser(event)
	return {
		success: true,
		errors: [],
		messages: [],
		result: {
			user,
			connections: user ? userConnections(user.id).map(describeConnection) : [],
			sharedWithMe: user ? memberShares(user.id).length : 0
		}
	}
})
