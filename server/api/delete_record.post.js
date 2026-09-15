import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
import { readId } from '../utils/ids'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')
		const recordId = readId(body.currDnsRecord, 'DNS record ID')

		const result = await cfFetch({
			apiKey: body.apiKey,
			method: 'DELETE',
			path: `/zones/${zoneId}/dns_records/${recordId}`
		})

		// Drop cached record lists so the next load can't bring the deleted record back.
		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [`/zones/${zoneId}`] })
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Couldn’t delete the DNS record: ${error?.message || 'unknown error'}`
		})
	}
})
