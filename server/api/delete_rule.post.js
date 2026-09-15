import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'
import { readId } from '../utils/ids'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')
		const rulesetId = readId(body.rulesetId, 'Ruleset ID')
		const ruleId = readId(body.ruleId, 'Rule ID')

		return await cfFetch({
			apiKey: body.apiKey,
			method: 'DELETE',
			path: `/zones/${zoneId}/rulesets/${rulesetId}/rules/${ruleId}`
		})
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
