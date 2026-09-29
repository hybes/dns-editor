import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { invalidateCfCache } from '../utils/cfFetch'
import { cfCommand, cfCommandPath } from '../utils/cfCommand'
import { buildRecordBody } from '../utils/dnsRecordBody'
import { readId } from '../utils/ids'

const invalid = (statusMessage) => createError({ statusCode: 400, message: statusMessage })

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) throw invalid('API key is required')
		const zoneId = readId(body.currZone, 'Zone ID')

		const result = await cfCommand({
			apiKey: body.apiKey,
			command: 'dns records create',
			zone: zoneId,
			body: buildRecordBody(body.dns)
		})

		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [await cfCommandPath('zones get', { zone: zoneId })] })
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: `Couldn’t create the record: ${error?.message || 'Unknown error'}`
		})
	}
})
