import { describeConnection, userConnections } from '../../utils/connections'

// The signed-in account's Cloudflare connections, without their tokens.
export default defineEventHandler((event) => ({
	success: true,
	errors: [],
	messages: [],
	result: userConnections(event.context.user.id).map(describeConnection)
}))
