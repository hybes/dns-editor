import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { invalidateCfCache } from '../utils/cfFetch'
import { cfCommand, cfCommandPath } from '../utils/cfCommand'
import { buildRecordBody } from '../utils/dnsRecordBody'
import { readId } from '../utils/ids'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')
		const recordId = readId(body.currDnsRecord, 'DNS record ID')

		// `update` is cf's PUT, which replaces the whole record and keeps a change of type
		// predictable. The body carries the record's tags and settings back so they survive.
		const result = await cfCommand({
			apiKey: body.apiKey,
			command: 'dns records update',
			zone: zoneId,
			args: { 'dns-record-id': recordId },
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
			message: `Couldn’t save the record: ${error?.message || 'Unknown error'}`
		})
	}
})
