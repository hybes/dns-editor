import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { removeConnection } from '../../utils/connections'

// Removes one of the signed-in account's connections and forgets its token. The token itself
// keeps working in Cloudflare until it's deleted there. Body: { id }.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	if (!removeConnection(event.context.user.id, Number(body.id))) {
		throw createError({ statusCode: 404, message: 'That connection doesn’t exist.' })
	}
	return { success: true, errors: [], messages: [], result: null }
})
