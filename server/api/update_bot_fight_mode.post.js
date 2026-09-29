import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { invalidateCfCache } from '../utils/cfFetch'
import { cfCommand, cfCommandPath } from '../utils/cfCommand'
import { readId } from '../utils/ids'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		if (typeof body.fight_mode !== 'boolean') {
			throw createError({ statusCode: 400, message: 'fight_mode must be true or false' })
		}

		// cf's `update` is a PUT, but Cloudflare keeps the fields it leaves out, so sending
		// fight_mode alone is safe.
		const result = await cfCommand({
			apiKey: body.apiKey,
			command: 'bot-management update',
			zone: zoneId,
			body: { fight_mode: body.fight_mode }
		})

		// Clear only the bot settings (also used by the capability probe), not the cached records.
		if (result?.success) {
			const path = await cfCommandPath('bot-management get', { zone: zoneId })
			invalidateCfCache({ apiKey: body.apiKey, paths: [path] })
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: error?.message || 'Unknown error'
		})
	}
})
