import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { describeCfErrors, invalidateCfCache } from '../utils/cfFetch'
import { cfCommand, cfCommandPath } from '../utils/cfCommand'
import { readId } from '../utils/ids'
import { log } from '../../shared/utils/log'

// Fields a partial update (cf's `edit`, a PATCH) may send. It leaves everything else on the record (tags,
// settings, comment) untouched, where a full PUT would overwrite what it isn't given.
const PATCHABLE_FIELDS = new Set([
	'proxied',
	'ttl',
	'comment',
	'content',
	'name',
	'priority',
	'data',
	'tags',
	'settings'
])

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')
		const recordId = readId(body.currDnsRecord, 'DNS record ID')

		const patch = body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch) ? body.patch : {}
		const changes = Object.fromEntries(Object.entries(patch).filter(([field]) => PATCHABLE_FIELDS.has(field)))

		if (!Object.keys(changes).length) {
			throw createError({ statusCode: 400, message: 'Send at least one record field to change' })
		}

		if ('proxied' in changes && typeof changes.proxied !== 'boolean') {
			throw createError({ statusCode: 400, message: 'Proxied must be true or false' })
		}

		const result = await cfCommand({
			apiKey: body.apiKey,
			command: 'dns records edit',
			zone: zoneId,
			args: { 'dns-record-id': recordId },
			body: changes
		})

		const facts = {
			zoneId,
			recordId,
			recordType: result?.result?.type,
			recordName: result?.result?.name,
			fields: Object.keys(changes),
			changes,
			userId: event.context.user?.id,
			username: event.context.user?.username
		}
		const fields = Object.keys(changes).join(', ')
		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [await cfCommandPath('zones get', { zone: zoneId })] })
			log.info(
				'dns',
				`${facts.username} changed ${fields} on ${facts.recordType} ${facts.recordName} in zone ${zoneId}`,
				facts
			)
		} else {
			log.warn(
				'dns',
				`change of ${fields} on record ${recordId} in zone ${zoneId} refused: ${describeCfErrors(result)}`,
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
			message: `Couldn’t update the DNS record: ${error?.message || 'unknown error'}`
		})
	}
})
