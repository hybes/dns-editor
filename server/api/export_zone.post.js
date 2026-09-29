import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfCommand } from '../utils/cfCommand'
import { readId } from '../utils/ids'

// Returns the zone's DNS records as a BIND zone file (Cloudflare's native export).
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}
		const zoneId = readId(body.currZone, 'Zone ID')

		const result = await cfCommand({ apiKey: body.apiKey, command: 'dns records export', zone: zoneId })

		if (!result.success || typeof result.result?.text !== 'string') {
			throw createError({
				statusCode: 502,
				message: result.errors?.[0]?.message || 'Cloudflare didn’t return the zone file'
			})
		}

		return { success: true, result: { zoneFile: result.result.text } }
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: `Couldn’t export the zone file: ${error?.message || 'unknown error'}`
		})
	}
})
