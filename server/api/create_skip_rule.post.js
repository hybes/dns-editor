import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		if (!body.currZone) {
			throw createError({ statusCode: 400, statusMessage: 'Zone ID is required' })
		}

		if (!body.rulesetId) {
			throw createError({ statusCode: 400, statusMessage: 'Ruleset ID is required' })
		}

		if (!body.bypassToken) {
			throw createError({ statusCode: 400, statusMessage: 'Bypass token is required' })
		}

		// The token is interpolated into a Cloudflare WAF rule expression, so constrain it
		// to a safe character set to prevent expression injection.
		if (!/^[A-Za-z0-9_-]{8,256}$/.test(body.bypassToken)) {
			throw createError({
				statusCode: 400,
				statusMessage: 'Bypass token must be 8-256 characters using letters, numbers, hyphens or underscores'
			})
		}

		const actionParameters =
			body.actionParameters && typeof body.actionParameters === 'object' ? body.actionParameters : {}

		const cleaned = {}
		if (actionParameters.ruleset) cleaned.ruleset = actionParameters.ruleset
		if (Array.isArray(actionParameters.phases) && actionParameters.phases.length)
			cleaned.phases = actionParameters.phases
		if (Array.isArray(actionParameters.products) && actionParameters.products.length)
			cleaned.products = actionParameters.products

		if (!cleaned.ruleset && !cleaned.phases && !cleaned.products) {
			cleaned.ruleset = 'current'
		}

		const expression = `(any(http.request.headers["x-cf-bypass-token"][*] eq "${body.bypassToken}"))`

		const payload = {
			action: 'skip',
			action_parameters: cleaned,
			expression,
			description: body.description || ''
		}

		if (typeof body.enabled === 'boolean') payload.enabled = body.enabled
		if (typeof body.loggingEnabled === 'boolean') payload.logging = { enabled: body.loggingEnabled }

		return await cfFetch({
			apiKey: body.apiKey,
			method: 'POST',
			path: `/zones/${body.currZone}/rulesets/${body.rulesetId}/rules`,
			body: payload
		})
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
