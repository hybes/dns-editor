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
		const recordId = readId(body.currDnsRecord, 'DNS record ID')

		// Cloudflare's envelope is returned as-is, including success:false for a missing or
		// forbidden record, so the client can show Cloudflare's own message. Never cached:
		// the edit panel asks for this to get the latest version.
		return await cfFetch({
			apiKey: body.apiKey,
			method: 'GET',
			path: `/zones/${zoneId}/dns_records/${recordId}`
		})
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Couldn’t load the DNS record: ${error?.message || 'Unknown error'}`
		})
	}
})
