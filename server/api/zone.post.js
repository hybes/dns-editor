import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'
import { readId } from '../utils/ids'

const CACHE_TTL = 15000

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		// fresh:true skips the stored answer, so an explicit refresh shows changes made elsewhere.
		const fresh = body.fresh === true
		const get = (path) => cfFetch({ apiKey: body.apiKey, method: 'GET', path, cacheTtl: CACHE_TTL, fresh })

		const [data, sslData] = await Promise.all([get(`/zones/${zoneId}`), get(`/zones/${zoneId}/settings/ssl`)])
		if (!data?.success) return data

		// The zone still loads when its SSL setting can't be read; the error says why.
		data.result.ssl = sslData?.success
			? sslData.result
			: { value: 'unknown', error: sslData?.errors?.[0]?.message || 'Cloudflare didn’t return the SSL setting' }

		return data
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Error fetching zone: ${error?.message || 'Unknown error'}`
		})
	}
})
