import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { findCfCommand, findLocalCommand, getCatalogue } from '../../utils/cfCatalogue'

// Everything `cf <command> --help` and `cf schema <command>` show: arguments, flags, where
// each goes in the request, and the API method and path. Body: { command }
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	const name = typeof body.command === 'string' ? body.command : ''
	if (!name.trim()) throw createError({ statusCode: 400, message: 'Name a cf command' })

	const [command, catalogue] = await Promise.all([findCfCommand(name), getCatalogue()])
	if (command) return { success: true, result: { ...command, version: catalogue.version } }

	const local = await findLocalCommand(name)
	if (local) return { success: true, result: { ...local, local: true, version: catalogue.version } }

	throw createError({ statusCode: 404, message: `cf has no command called “${name.trim()}”` })
})
