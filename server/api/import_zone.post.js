import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetchMultipart, invalidateCfCache } from '../utils/cfFetch'

// Imports DNS records from a pasted/uploaded BIND zone file (Cloudflare's native import).
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}
		if (!body.currZone) {
			throw createError({ statusCode: 400, statusMessage: 'Zone ID is required' })
		}
		if (!body.zoneFile || !String(body.zoneFile).trim()) {
			throw createError({ statusCode: 400, statusMessage: 'A BIND zone file is required' })
		}

		const form = new FormData()
		form.append('file', new Blob([String(body.zoneFile)], { type: 'text/plain' }), 'import.txt')
		// proxied=false keeps imported records DNS-only unless the file says otherwise.
		form.append('proxied', body.proxied === true ? 'true' : 'false')

		const result = await cfFetchMultipart({
			apiKey: body.apiKey,
			path: `/zones/${body.currZone}/dns_records/import`,
			form
		})

		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [`/zones/${body.currZone}`] })
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({ statusCode: 500, statusMessage: 'Failed to import zone' })
	}
})
