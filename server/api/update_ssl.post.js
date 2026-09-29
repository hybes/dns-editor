import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { invalidateCfCache } from '../utils/cfFetch'
import { cfCommand, cfCommandPath } from '../utils/cfCommand'
import { readId } from '../utils/ids'

const SSL_MODES = new Set(['off', 'flexible', 'full', 'strict'])

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		if (!SSL_MODES.has(body.ssl)) {
			throw createError({ statusCode: 400, message: 'SSL mode must be off, flexible, full or strict' })
		}

		const setting = { zone: zoneId, args: { 'setting-id': 'ssl' } }
		const result = await cfCommand({
			apiKey: body.apiKey,
			command: 'zones settings edit',
			...setting,
			body: { value: body.ssl }
		})

		// Clear only the SSL setting: the zone details read it from this path, and clearing
		// the whole zone prefix would also throw away cached records.
		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [await cfCommandPath('zones settings get', setting)] })
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: error?.message || 'Unknown error'
		})
	}
})
