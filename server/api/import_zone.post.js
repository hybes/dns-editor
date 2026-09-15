import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetchMultipart, invalidateCfCache } from '../utils/cfFetch'
import { readId } from '../utils/ids'

// Imports DNS records from a pasted or uploaded BIND zone file (Cloudflare's native import).
// Cloudflare answers with recs_added and total_records_parsed, which the page reports.
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}
		const zoneId = readId(body.currZone, 'Zone ID')
		if (!body.zoneFile || !String(body.zoneFile).trim()) {
			throw createError({ statusCode: 400, statusMessage: 'Paste or upload a BIND zone file to import' })
		}

		const form = new FormData()
		form.append('file', new Blob([String(body.zoneFile)], { type: 'text/plain' }), 'import.txt')
		// Only proxiable records (A, AAAA, CNAME) are affected; the rest are always DNS only.
		form.append('proxied', body.proxied === true ? 'true' : 'false')

		const result = await cfFetchMultipart({
			apiKey: body.apiKey,
			path: `/zones/${zoneId}/dns_records/import`,
			form
		})

		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [`/zones/${zoneId}`] })
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Couldn’t import the zone file: ${error?.message || 'unknown error'}`
		})
	}
})
