import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetchText } from '../utils/cfFetch'
import { readId } from '../utils/ids'

// Returns the zone's DNS records as a BIND zone file (Cloudflare's native export).
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}
		const zoneId = readId(body.currZone, 'Zone ID')

		const result = await cfFetchText({
			apiKey: body.apiKey,
			path: `/zones/${zoneId}/dns_records/export`
		})

		if (!result.success) {
			throw createError({
				statusCode: 502,
				statusMessage: result.errors?.[0]?.message || 'Cloudflare didn’t return the zone file'
			})
		}

		return { success: true, result: { zoneFile: result.text } }
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Couldn’t export the zone file: ${error?.message || 'unknown error'}`
		})
	}
})
