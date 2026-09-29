import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { listZones } from '../utils/cfLists'
import { cfCommand } from '../utils/cfCommand'
import { connectionsWithTokens, tokenFor } from '../utils/connections'
import { sharedZones } from '../utils/shares'

const SHARED_TTL = 60_000

// Zones others have shared with this account, read with each owner's connection. A zone the
// owner can no longer see is still listed, marked unavailable, so it doesn't vanish silently.
async function sharedList(userId, ownIds, fresh) {
	const shared = sharedZones(userId).filter((item) => !ownIds.has(item.zoneId))
	return Promise.all(
		shared.map(async (item) => {
			const tag = { owner: item.owner, shareId: item.shareId, levels: item.levels }
			try {
				const { token } = await tokenFor(item.ownerId, { zone: item.zoneId })
				const zone = await cfCommand({
					apiKey: token,
					command: 'zones get',
					zone: item.zoneId,
					cacheTtl: SHARED_TTL,
					fresh
				})
				if (zone?.success) return { ...zone.result, connection: null, shared: tag }
			} catch {
				// Listed as unavailable below.
			}
			return { id: item.zoneId, name: item.zoneName, status: 'unavailable', connection: null, shared: tag }
		})
	)
}

// Every zone the signed-in account's connections can see, each tagged with the connection it
// came from ({ id, label }), then the zones others share with it, tagged `shared` ({ owner,
// shareId, levels }). A zone two connections can see is listed once, under the first.
// Body: { fresh? }. When some connections fail, the zones from the others still come back,
// with the failures in `failures`; when all fail, the first failure is the answer.
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)
		const userId = event.context.user.id
		const connections = connectionsWithTokens(userId)
		const lists = await Promise.all(
			connections.map((connection) => listZones(connection.token, { fresh: Boolean(body.fresh) }))
		)
		const byId = new Map()
		const failures = []
		lists.forEach((list, index) => {
			const { id, label } = connections[index]
			if (!list?.success) {
				failures.push({
					connection: { id, label },
					message: list?.errors?.[0]?.message || 'Cloudflare didn’t answer'
				})
				return
			}
			for (const zone of list.result) {
				if (!byId.has(zone.id)) byId.set(zone.id, { ...zone, connection: { id, label } })
			}
		})
		const shared = await sharedList(userId, new Set(byId.keys()), Boolean(body.fresh))
		if (connections.length && failures.length === connections.length && !shared.length) return lists[0]
		const result = [...byId.values(), ...shared]
		return {
			success: true,
			errors: [],
			messages: [],
			result,
			failures,
			result_info: {
				page: 1,
				per_page: result.length,
				count: result.length,
				total_count: result.length,
				total_pages: 1
			}
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({ statusCode: 500, message: error?.message || 'Unknown error' })
	}
})
