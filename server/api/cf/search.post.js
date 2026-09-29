import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { searchCfCommands } from '../../utils/cfCatalogue'

const MAX_RESULTS = 50

// `cf cli search`: finds commands by what they do. Body: { query, limit? }
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	const query = typeof body.query === 'string' ? body.query.trim() : ''
	if (query.length > 200) {
		throw createError({ statusCode: 400, message: 'Search for 200 characters or fewer' })
	}
	const limit = Math.min(MAX_RESULTS, Math.max(1, Number.parseInt(body.limit, 10) || 5))
	return { success: true, result: await searchCfCommands(query, { limit }) }
})
