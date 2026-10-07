import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { preferConnection } from '../../utils/connections'

export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	if (!preferConnection(event.context.user.id, Number(body.id))) {
		throw createError({ statusCode: 404, message: 'That connection doesn’t exist.' })
	}
	return { success: true, errors: [], messages: [], result: null }
})
