import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { renameConnection } from '../../utils/connections'

// Renames one of the signed-in account's connections. Body: { id, label }.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : ''
	if (!label) throw createError({ statusCode: 400, message: 'Enter a name for the connection.' })
	if (!renameConnection(event.context.user.id, Number(body.id), label)) {
		throw createError({ statusCode: 404, message: 'That connection doesn’t exist.' })
	}
	return { success: true, errors: [], messages: [], result: null }
})
