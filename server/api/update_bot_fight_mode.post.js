import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		if (!body.currZone) {
			throw createError({ statusCode: 400, statusMessage: 'Zone ID is required' })
		}

		if (typeof body.fight_mode !== 'boolean') {
			throw createError({ statusCode: 400, statusMessage: 'fight_mode must be a boolean' })
		}

		const result = await cfFetch({
			apiKey: body.apiKey,
			method: 'PUT',
			path: `/zones/${body.currZone}/bot_management`,
			body: { fight_mode: body.fight_mode }
		})

		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [`/zones/${body.currZone}`] })
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
