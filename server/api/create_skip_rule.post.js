import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'
import { readId } from '../utils/ids'

// The token is interpolated into a Cloudflare rule expression, so constrain it to a safe
// character set to prevent expression injection.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,256}$/

// What a skip rule may bypass depends on its phase. Custom rules can skip later phases and
// the older products; a managed-rules exception can only skip the rest of its ruleset.
// Rate limiting and the other phases have no skip action.
const SKIP_OPTIONS = {
	http_request_firewall_custom: {
		phases: ['http_ratelimit', 'http_request_sbfm', 'http_request_firewall_managed'],
		products: ['zoneLockdown', 'uaBlock', 'bic', 'hot', 'securityLevel', 'rateLimit', 'waf']
	},
	http_request_firewall_managed: { phases: [], products: [] }
}

const text = (value) => (typeof value === 'string' ? value.trim() : '')

const badRequest = (statusMessage) => createError({ statusCode: 400, statusMessage })

const readChoices = (value, allowed, noun) => {
	if (value === undefined || value === null) return []
	if (!Array.isArray(value)) throw badRequest(`Skipped ${noun} must be a list`)
	const choices = [...new Set(value)]
	const invalid = choices.find((choice) => !allowed.includes(choice))
	if (invalid !== undefined) {
		throw badRequest(`“${invalid}” can’t be skipped from this phase`)
	}
	return choices
}

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)
		const phase = text(body.phase)
		const token = text(body.bypassToken)

		if (!body.apiKey) {
			throw badRequest('API key is required')
		}

		const zoneId = readId(body.currZone, 'Zone ID')
		const rulesetId = readId(body.rulesetId, 'Ruleset ID')

		const options = SKIP_OPTIONS[phase]
		if (!options) {
			throw badRequest('Bypass rules can only be added to custom rules or managed rules')
		}

		if (!token) {
			throw badRequest('Bypass token is required')
		}

		if (!TOKEN_PATTERN.test(token)) {
			throw badRequest('Bypass token must be 8–256 characters using letters, numbers, hyphens or underscores')
		}

		if (body.description !== undefined && typeof body.description !== 'string') {
			throw badRequest('Description must be text')
		}

		const requested =
			body.actionParameters && typeof body.actionParameters === 'object' ? body.actionParameters : {}

		if (requested.ruleset !== undefined && requested.ruleset !== 'current') {
			throw badRequest('Only the rest of the current ruleset can be skipped')
		}

		const actionParameters = {}
		if (requested.ruleset === 'current') actionParameters.ruleset = 'current'

		const phases = readChoices(requested.phases, options.phases, 'phases')
		if (phases.length) actionParameters.phases = phases

		const products = readChoices(requested.products, options.products, 'products')
		if (products.length) actionParameters.products = products

		if (!Object.keys(actionParameters).length) {
			throw badRequest('Choose at least one thing for the rule to skip')
		}

		const payload = {
			action: 'skip',
			action_parameters: actionParameters,
			expression: `(any(http.request.headers["x-cf-bypass-token"][*] eq "${token}"))`,
			description: text(body.description),
			// Cloudflare appends new rules by default, where skipping "the rest of this ruleset"
			// would skip nothing. First place makes the bypass apply before every other rule.
			position: { before: '' }
		}

		if (typeof body.enabled === 'boolean') payload.enabled = body.enabled
		if (typeof body.loggingEnabled === 'boolean') payload.logging = { enabled: body.loggingEnabled }

		return await cfFetch({
			apiKey: body.apiKey,
			method: 'POST',
			path: `/zones/${zoneId}/rulesets/${rulesetId}/rules`,
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
