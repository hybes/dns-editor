import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfCommand } from '../utils/cfCommand'
import { readId } from '../utils/ids'
import { withZoneBucket } from '../utils/zoneBuckets'

const CACHE_TTL = 15000

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		// fresh:true skips the stored answer, so an explicit refresh shows changes made elsewhere.
		const fresh = body.fresh === true
		const run = (command, input) =>
			cfCommand({ apiKey: body.apiKey, command, zone: zoneId, ...input, cacheTtl: CACHE_TTL, fresh })

		const [data, sslData] = await Promise.all([
			run('zones get'),
			run('zones settings get', { args: { 'setting-id': 'ssl' } })
		])
		if (!data?.success) return data

		// The zone still loads when its SSL setting can't be read; the error says why.
		data.result.ssl = sslData?.success
			? sslData.result
			: { value: 'unknown', error: sslData?.errors?.[0]?.message || 'Cloudflare didn’t return the SSL setting' }

		return { ...data, result: withZoneBucket(data.result) }
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: `Error fetching zone: ${error?.message || 'Unknown error'}`
		})
	}
})
