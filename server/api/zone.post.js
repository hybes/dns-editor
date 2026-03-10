import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		if (!body.currZone) {
			throw createError({ statusCode: 400, statusMessage: 'Zone ID is required' })
		}

		const [data, sslData] = await Promise.all([
			cfFetch({ apiKey: body.apiKey, method: 'GET', path: `/zones/${body.currZone}`, cacheTtl: 15000 }),
			cfFetch({
				apiKey: body.apiKey,
				method: 'GET',
				path: `/zones/${body.currZone}/settings/ssl`,
				cacheTtl: 15000
			})
		])
		if (!data.success) return data
		data.result.ssl = sslData && sslData.success ? sslData.result : { value: 'unknown' }

		return data
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Error fetching zone: ${error?.message || 'Unknown error'}`
		})
	}
})
