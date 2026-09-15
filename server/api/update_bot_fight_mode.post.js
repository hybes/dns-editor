import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
import { readId } from '../utils/ids'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		if (typeof body.fight_mode !== 'boolean') {
			throw createError({ statusCode: 400, statusMessage: 'fight_mode must be true or false' })
		}

		// Cloudflare keeps the fields a PUT leaves out, so sending fight_mode alone is safe.
		const result = await cfFetch({
			apiKey: body.apiKey,
			method: 'PUT',
			path: `/zones/${zoneId}/bot_management`,
			body: { fight_mode: body.fight_mode }
		})

		// Clear only the bot settings (also used by the capability probe), not the cached records.
		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [`/zones/${zoneId}/bot_management`] })
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
