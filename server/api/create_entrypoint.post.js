import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'
import { readId } from '../utils/ids'

// The zone phases the Rules page lists.
const ZONE_PHASES = new Set([
	'http_request_firewall_custom',
	'http_ratelimit',
	'http_request_firewall_managed',
	'http_request_transform',
	'http_request_late_transform',
	'http_response_headers_transform',
	'http_request_dynamic_redirect',
	'http_request_origin',
	'http_config_settings',
	'http_request_cache_settings',
	'http_response_compression',
	'http_custom_errors'
])

const text = (value) => (typeof value === 'string' ? value.trim() : '')

// Creates an empty entry point ruleset for one phase. This deliberately uses POST rather than
// PUT /rulesets/phases/{phase}/entrypoint: that PUT replaces every rule already in the entry
// point, so a page showing a stale list could wipe live rules. Cloudflare refuses the POST
// when the phase already has an entry point, which leaves existing rules untouched.
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)
		const phase = text(body.phase)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		if (!ZONE_PHASES.has(phase)) {
			throw createError({
				statusCode: 400,
				statusMessage: 'Choose a supported phase for the entry point ruleset'
			})
		}

		return await cfFetch({
			apiKey: body.apiKey,
			method: 'POST',
			path: `/zones/${zoneId}/rulesets`,
			body: { name: 'default', kind: 'zone', phase, rules: [] }
		})
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
