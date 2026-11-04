import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { describeCfErrors, invalidateCfCache } from '../utils/cfFetch'
import { cfCommand, cfCommandPath } from '../utils/cfCommand'
import { readId } from '../utils/ids'
import { log, logText } from '../../shared/utils/log'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')
		const recordId = readId(body.currDnsRecord, 'DNS record ID')

		const result = await cfCommand({
			apiKey: body.apiKey,
			command: 'dns records delete',
			zone: zoneId,
			args: { 'dns-record-id': recordId }
		})

		const facts = { zoneId, recordId, userId: event.context.user?.id, username: event.context.user?.username }
		// Drop cached record lists so the next load can't bring the deleted record back.
		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [await cfCommandPath('zones get', { zone: zoneId })] })
			log.info('dns', logText`${facts.username} deleted record ${recordId} in zone ${zoneId}`, facts)
		} else {
			log.warn(
				'dns',
				logText`delete of record ${recordId} in zone ${zoneId} refused: ${describeCfErrors(result)}`,
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
			message: `Couldn’t delete the DNS record: ${error?.message || 'unknown error'}`
		})
	}
})
