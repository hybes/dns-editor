import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { browseCfCommands, getCatalogue } from '../../utils/cfCatalogue'

// One level of cf's command tree, as `cf <group> --help` lists it. Body: { prefix? }
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	const prefix = typeof body.prefix === 'string' ? body.prefix : ''
	if (prefix.length > 200) throw createError({ statusCode: 400, message: 'That group name is too long' })
	const [level, catalogue] = await Promise.all([browseCfCommands(prefix), getCatalogue()])
	if (prefix.trim() && !level.groups.length && !level.commands.length) {
		throw createError({ statusCode: 404, message: `cf has no command group called “${prefix.trim()}”` })
	}
	return {
		success: true,
		result: { ...level, version: catalogue.version, source: catalogue.source, total: catalogue.commands.length }
	}
})
