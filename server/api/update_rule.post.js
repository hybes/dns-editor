import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfCommand } from '../utils/cfCommand'
import { readId } from '../utils/ids'

// Fields that describe the stored rule rather than define it; Cloudflare doesn't accept them back.
const READ_ONLY_FIELDS = new Set(['id', 'version', 'last_updated'])

// Turns a rule on or off. cf's `rules update` is a PATCH that replaces the rule with whatever is sent, so the
// current definition is read first and sent back with only `enabled` changed.
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')
		const rulesetId = readId(body.rulesetId, 'Ruleset ID')
		const ruleId = readId(body.ruleId, 'Rule ID')

		if (typeof body.enabled !== 'boolean') {
			throw createError({ statusCode: 400, message: 'Enabled must be true or false' })
		}

		const current = await cfCommand({
			apiKey: body.apiKey,
			command: 'rulesets account-rulesets get',
			zone: zoneId,
			args: { 'ruleset-id': rulesetId }
		})
		if (!current?.success) return current

		const rule = (current.result?.rules || []).find((item) => item?.id === ruleId)
		if (!rule) {
			throw createError({
				statusCode: 404,
				message: 'This rule no longer exists in the ruleset. Refresh the rules to see the current list.'
			})
		}

		const definition = Object.fromEntries(Object.entries(rule).filter(([key]) => !READ_ONLY_FIELDS.has(key)))
		definition.enabled = body.enabled

		return await cfCommand({
			apiKey: body.apiKey,
			command: 'rulesets account-rulesets rules update',
			zone: zoneId,
			args: { 'rule-id': ruleId },
			flags: { 'ruleset-id': rulesetId },
			body: definition
		})
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: error?.message || 'Unknown error'
		})
	}
})
