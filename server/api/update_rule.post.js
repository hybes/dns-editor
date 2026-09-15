import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'
import { readId } from '../utils/ids'

// Fields that describe the stored rule rather than define it; Cloudflare doesn't accept them back.
const READ_ONLY_FIELDS = new Set(['id', 'version', 'last_updated'])

// Turns a rule on or off. Cloudflare's PATCH replaces the rule with whatever is sent, so the
// current definition is read first and sent back with only `enabled` changed.
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')
		const rulesetId = readId(body.rulesetId, 'Ruleset ID')
		const ruleId = readId(body.ruleId, 'Rule ID')

		if (typeof body.enabled !== 'boolean') {
			throw createError({ statusCode: 400, statusMessage: 'Enabled must be true or false' })
		}

		const current = await cfFetch({
			apiKey: body.apiKey,
			method: 'GET',
			path: `/zones/${zoneId}/rulesets/${rulesetId}`
		})
		if (!current?.success) return current

		const rule = (current.result?.rules || []).find((item) => item?.id === ruleId)
		if (!rule) {
			throw createError({
				statusCode: 404,
				statusMessage: 'This rule no longer exists in the ruleset. Refresh the rules to see the current list.'
			})
		}

		const definition = Object.fromEntries(Object.entries(rule).filter(([key]) => !READ_ONLY_FIELDS.has(key)))
		definition.enabled = body.enabled

		return await cfFetch({
			apiKey: body.apiKey,
			method: 'PATCH',
			path: `/zones/${zoneId}/rulesets/${rulesetId}/rules/${ruleId}`,
			body: definition
		})
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
