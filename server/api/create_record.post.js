import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { describeCfErrors, invalidateCfCache } from '../utils/cfFetch'
import { cfCommand, cfCommandPath } from '../utils/cfCommand'
import { buildRecordBody } from '../utils/dnsRecordBody'
import { readId } from '../utils/ids'
import { log } from '../../shared/utils/log'

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

		const record = result?.result || body.dns || {}
		const facts = {
			zoneId,
			recordId: result?.result?.id,
			recordType: record.type,
			recordName: record.name,
			content: record.content,
			proxied: record.proxied,
			userId: event.context.user?.id,
			username: event.context.user?.username
		}
		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [await cfCommandPath('zones get', { zone: zoneId })] })
			log.info('dns', `${facts.username} created ${record.type} ${record.name} in zone ${zoneId}`, facts)
		} else {
			log.warn(
				'dns',
				`create ${record.type} ${record.name} in zone ${zoneId} refused: ${describeCfErrors(result)}`,
				{
					...facts,
					cfErrors: describeCfErrors(result)
				}
			)
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			cause: error,
			message: `Couldn’t create the record: ${error?.message || 'Unknown error'}`
		})
	}
})
