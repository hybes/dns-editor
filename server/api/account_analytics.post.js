import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		if (!body.currZone) throw createError({ statusCode: 400, statusMessage: 'Zone ID is required' })

		const zoneData = await cfFetch({ apiKey: body.apiKey, method: 'GET', path: `/zones/${body.currZone}` })
		if (!zoneData.success) return zoneData

		const accountId = zoneData.result?.account?.id
		if (!accountId) throw createError({ statusCode: 400, statusMessage: 'Account ID is required' })

		const kind = body.kind || 'dnsQueryCount'
		const range = body.range || {}
		const dateGeq = range.date_geq || '2025-01-01'
		const dateLeq = range.date_leq || '2025-01-02'

		if (kind === 'dnsQueryCount') {
			const data = await cfFetch({
				apiKey: body.apiKey,
				method: 'POST',
				path: '/graphql',
				body: {
					query: 'query ($accountTag: String!, $date_geq: Date!, $date_leq: Date!) { viewer { accounts(filter: { accountTag: $accountTag }) { dnsAnalyticsAdaptiveGroups(filter: { date_geq: $date_geq, date_leq: $date_leq } limit: 1) { count } } } }',
					variables: { accountTag: accountId, date_geq: dateGeq, date_leq: dateLeq }
				}
			})

			// GraphQL responses report failure via an `errors` array rather than `success:false`,
			// so normalise to the same envelope the rest of the API uses.
			if (data?.errors?.length) {
				return { success: false, errors: data.errors }
			}
			return { success: true, result: data?.data ?? null }
		}

		throw createError({ statusCode: 400, statusMessage: 'Unknown analytics kind' })
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
