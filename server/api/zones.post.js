import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'

// 50 is the most Cloudflare returns per page of zones.
const PER_PAGE = 50
const CACHE_TTL = 30000
// Large accounts list quickly without a burst of requests against Cloudflare's rate limit.
const CONCURRENCY = 4

const noResponse = (page) => ({
	success: false,
	errors: [{ message: `Cloudflare returned nothing for page ${page} of the zone list. Try again.` }]
})

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const fetchPage = (page) =>
			cfFetch({
				apiKey: body.apiKey,
				method: 'GET',
				path: `/zones?page=${page}&per_page=${PER_PAGE}`,
				cacheTtl: CACHE_TTL,
				fresh: Boolean(body.fresh)
			})

		const first = await fetchPage(1)
		if (!first?.success) return first || noResponse(1)

		const totalPages = Math.max(1, Number(first.result_info?.total_pages) || 1)
		const remaining = Array.from({ length: totalPages - 1 }, (_, index) => index + 2)
		const pages = []
		let next = 0
		let failure = null

		// A list with a page missing would hide zones without saying so, so one failed page
		// fails the whole request and no further pages are started.
		const worker = async () => {
			while (!failure && next < remaining.length) {
				const index = next++
				const page = remaining[index]
				const data = await fetchPage(page)
				if (data?.success) pages[index] = data.result || []
				else failure ||= data || noResponse(page)
			}
		}
		await Promise.all(Array.from({ length: Math.min(CONCURRENCY, remaining.length) }, worker))
		if (failure) return failure

		// A zone added or removed mid-listing shifts page boundaries, which can repeat a zone.
		const byId = new Map()
		for (const zone of [first.result || [], ...pages].flat()) {
			if (zone?.id) byId.set(zone.id, zone)
		}
		const result = [...byId.values()]

		return {
			...first,
			result,
			result_info: {
				page: 1,
				per_page: result.length,
				count: result.length,
				total_count: result.length,
				total_pages: 1
			}
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
