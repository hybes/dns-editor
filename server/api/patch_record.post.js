import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
import { readId } from '../utils/ids'

// Fields a partial update may send. PATCH leaves everything else on the record (tags,
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
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')
		const recordId = readId(body.currDnsRecord, 'DNS record ID')

		const patch = body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch) ? body.patch : {}
		const changes = Object.fromEntries(Object.entries(patch).filter(([field]) => PATCHABLE_FIELDS.has(field)))

		if (!Object.keys(changes).length) {
			throw createError({ statusCode: 400, statusMessage: 'Send at least one record field to change' })
		}

		if ('proxied' in changes && typeof changes.proxied !== 'boolean') {
			throw createError({ statusCode: 400, statusMessage: 'Proxied must be true or false' })
		}

		const result = await cfFetch({
			apiKey: body.apiKey,
			method: 'PATCH',
			path: `/zones/${zoneId}/dns_records/${recordId}`,
			body: changes
		})

		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [`/zones/${zoneId}`] })
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Couldn’t update the DNS record: ${error?.message || 'unknown error'}`
		})
	}
})
