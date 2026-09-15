import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
import { readId } from '../utils/ids'

const SSL_MODES = new Set(['off', 'flexible', 'full', 'strict'])

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		if (!SSL_MODES.has(body.ssl)) {
			throw createError({ statusCode: 400, statusMessage: 'SSL mode must be off, flexible, full or strict' })
		}

		const result = await cfFetch({
			apiKey: body.apiKey,
			method: 'PATCH',
			path: `/zones/${zoneId}/settings/ssl`,
			body: { value: body.ssl }
		})

		// Clear only the SSL setting: the zone details read it from this path, and clearing
		// the whole zone prefix would also throw away cached records.
		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [`/zones/${zoneId}/settings/ssl`] })
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
