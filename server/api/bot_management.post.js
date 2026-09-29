import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfCommand } from '../utils/cfCommand'
import { readId } from '../utils/ids'

// Passes Cloudflare's envelope through unchanged. fight_mode only exists on the free
// plan's configuration, so the page decides what a missing value means.
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		return await cfCommand({
			apiKey: body.apiKey,
			command: 'bot-management get',
			zone: zoneId,
			cacheTtl: 15000,
			fresh: body.fresh === true
		})
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: error?.message || 'Unknown error'
		})
	}
})
