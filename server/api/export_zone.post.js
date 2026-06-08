import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetchText } from '../utils/cfFetch'

// Returns the zone's DNS records as a BIND zone file (Cloudflare's native export).
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}
		if (!body.currZone) {
			throw createError({ statusCode: 400, statusMessage: 'Zone ID is required' })
		}

		const result = await cfFetchText({
			apiKey: body.apiKey,
			path: `/zones/${body.currZone}/dns_records/export`
		})

		if (!result.success) {
			throw createError({
				statusCode: 502,
				statusMessage: result.errors?.[0]?.message || 'Failed to export zone'
			})
		}

		return { success: true, result: { zoneFile: result.text } }
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({ statusCode: 500, statusMessage: 'Failed to export zone' })
	}
})
