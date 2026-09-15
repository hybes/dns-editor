import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
import { buildRecordBody } from '../utils/dnsRecordBody'
import { readId } from '../utils/ids'

const invalid = (statusMessage) => createError({ statusCode: 400, statusMessage })

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) throw invalid('API key is required')
		const zoneId = readId(body.currZone, 'Zone ID')

		const result = await cfFetch({
			apiKey: body.apiKey,
			method: 'POST',
			path: `/zones/${zoneId}/dns_records`,
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
			statusMessage: `Couldn’t create the record: ${error?.message || 'Unknown error'}`
		})
	}
})
