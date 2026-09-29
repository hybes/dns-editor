import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfCommand } from '../utils/cfCommand'
import { readId } from '../utils/ids'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')
		const rulesetId = readId(body.rulesetId, 'Ruleset ID')
		const ruleId = readId(body.ruleId, 'Rule ID')

		return await cfCommand({
			apiKey: body.apiKey,
			command: 'rulesets account-rulesets rules delete',
			zone: zoneId,
			args: { 'rule-id': ruleId },
			flags: { 'ruleset-id': rulesetId }
		})
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: error?.message || 'Unknown error'
		})
	}
})
