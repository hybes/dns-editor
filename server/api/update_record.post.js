import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { describeCfErrors, invalidateCfCache } from '../utils/cfFetch'
import { cfCommand, cfCommandPath } from '../utils/cfCommand'
import { buildRecordBody } from '../utils/dnsRecordBody'
import { readId } from '../utils/ids'
import { log } from '../../shared/utils/log'

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

		const record = result?.result || body.dns || {}
		const facts = {
			zoneId,
			recordId,
			recordType: record.type,
			recordName: record.name,
			content: record.content,
			proxied: record.proxied,
			userId: event.context.user?.id,
			username: event.context.user?.username
		}
		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [await cfCommandPath('zones get', { zone: zoneId })] })
			log.info('dns', `${facts.username} updated ${record.type} ${record.name} in zone ${zoneId}`, facts)
		} else {
			log.warn('dns', `update of record ${recordId} in zone ${zoneId} refused: ${describeCfErrors(result)}`, {
				...facts,
				cfErrors: describeCfErrors(result)
			})
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			cause: error,
			message: `Couldn’t save the record: ${error?.message || 'Unknown error'}`
		})
	}
})
