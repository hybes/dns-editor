import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
import { buildRecordBody } from '../utils/dnsRecordBody'
import { readId } from '../utils/ids'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')
		const recordId = readId(body.currDnsRecord, 'DNS record ID')

		// PUT replaces the whole record, which keeps a change of type predictable. The body
		// carries the record's tags and settings back so they survive the overwrite.
		const result = await cfFetch({
			apiKey: body.apiKey,
			method: 'PUT',
			path: `/zones/${zoneId}/dns_records/${recordId}`,
			body: buildRecordBody(body.dns)
		})

		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [`/zones/${zoneId}`] })
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Couldn’t save the record: ${error?.message || 'Unknown error'}`
		})
	}
})
