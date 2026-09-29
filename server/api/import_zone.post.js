import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { invalidateCfCache } from '../utils/cfFetch'
import { cfCommand, cfCommandPath } from '../utils/cfCommand'
import { readId } from '../utils/ids'

// Imports DNS records from a pasted or uploaded BIND zone file (Cloudflare's native import).
// Cloudflare answers with recs_added and total_records_parsed, which the page reports.
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}
		const zoneId = readId(body.currZone, 'Zone ID')
		if (!body.zoneFile || !String(body.zoneFile).trim()) {
			throw createError({ statusCode: 400, message: 'Paste or upload a BIND zone file to import' })
		}

		const result = await cfCommand({
			apiKey: body.apiKey,
			command: 'dns records import',
			zone: zoneId,
			files: { file: { name: 'import.txt', text: String(body.zoneFile) } },
			// Only proxiable records (A, AAAA, CNAME) are affected; the rest are always DNS only.
			flags: { proxied: body.proxied === true ? 'true' : 'false' }
		})

		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [await cfCommandPath('zones get', { zone: zoneId })] })
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: `Couldn’t import the zone file: ${error?.message || 'unknown error'}`
		})
	}
})
