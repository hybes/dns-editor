import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfCommand } from '../utils/cfCommand'
import { readId } from '../utils/ids'

// Cloudflare returns at most 50 rulesets a page. A zone rarely needs more than one page;
// the cap only stops a cursor that never ends from looping forever.
const PAGE_SIZE = 50
const MAX_PAGES = 20

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		const rulesets = []
		let cursor = ''

		for (let page = 0; page < MAX_PAGES; page++) {
			const data = await cfCommand({
				apiKey: body.apiKey,
				command: 'rulesets account-rulesets list',
				zone: zoneId,
				flags: { 'per-page': PAGE_SIZE, cursor: cursor || undefined }
			})
			if (!data?.success) return data

			if (Array.isArray(data.result)) rulesets.push(...data.result)
			cursor = data.result_info?.cursors?.after || ''
			if (!cursor) break
		}

		return { success: true, errors: [], messages: [], result: rulesets }
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: error?.message || 'Unknown error'
		})
	}
})
