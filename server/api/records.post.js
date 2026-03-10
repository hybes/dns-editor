import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { fetchAllDnsRecords } from '../utils/dnsEditor'
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		if (!body.currZone) {
			throw createError({ statusCode: 400, statusMessage: 'Zone ID is required' })
		}

		return await fetchAllDnsRecords({ apiKey: body.apiKey, zoneId: body.currZone, cacheTtl: 15000 })
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Error fetching DNS records: ${error?.message || 'Unknown error'}`
		})
	}
})
