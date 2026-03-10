import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		let data = await cfFetch({ apiKey: body.apiKey, method: 'GET', path: '/zones', cacheTtl: 30000 })
		if (!data.result) data.result = []

		const totalPages = data?.result_info?.total_pages || 1
		if (data && totalPages > 1) {
			const pages = Array.from({ length: totalPages - 1 }, (_, idx) => idx + 2)
			const results = await Promise.all(
				pages.map((page) =>
					cfFetch({ apiKey: body.apiKey, method: 'GET', path: `/zones?page=${page}`, cacheTtl: 30000 })
				)
			)
			for (const pageData of results) {
				if (pageData && pageData.success && pageData.result) data.result = data.result.concat(pageData.result)
			}
		}

		if (body.getSsl && data && data.result) {
			const concurrency = 8
			const queue = data.result.filter((z) => z && z.id)
			let i = 0

			const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
				while (i < queue.length) {
					const idx = i++
					const zone = queue[idx]
					const sslData = await cfFetch({
						apiKey: body.apiKey,
						method: 'GET',
						path: `/zones/${zone.id}/settings/ssl`,
						cacheTtl: 30000
					})
					if (sslData && sslData.success) zone.ssl = sslData
				}
			})

			await Promise.all(workers)
		}

		return data
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
