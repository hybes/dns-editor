import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { fetchAllDnsRecords } from '../utils/dnsEditor'
import { readId } from '../utils/ids'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		// An explicit refresh or retry sends fresh:true so it really goes back to Cloudflare.
		return await fetchAllDnsRecords({
			apiKey: body.apiKey,
			zoneId,
			cacheTtl: 15000,
			fresh: body.fresh === true
		})
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Couldn’t load DNS records: ${error?.message || 'unknown error'}`
		})
	}
})
