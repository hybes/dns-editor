import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { listAccounts } from '../utils/cfLists'
import { connectionsWithTokens } from '../utils/connections'

// Every Cloudflare account the signed-in account's connections can use, for account pickers.
// Body: { fresh? }. As with zones, the first failure is the answer only when every connection
// fails.
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)
		const connections = connectionsWithTokens(event.context.user.id)
		const lists = await Promise.all(
			connections.map((connection) => listAccounts(connection.token, { fresh: body.fresh === true }))
		)
		const accounts = new Map()
		for (const list of lists) {
			for (const account of list?.success ? list.result : []) {
				if (!accounts.has(account.id)) accounts.set(account.id, account)
			}
		}
		if (connections.length && !accounts.size && lists.every((list) => !list?.success)) return lists[0]
		const result = [...accounts.values()].sort((a, b) => a.name.localeCompare(b.name))
		return { success: true, errors: [], messages: [], result }
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({ statusCode: 500, message: error?.message || 'Unknown error' })
	}
})
