import { createError } from 'h3'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
import { accountFields, readAccountBody, readAccountPayload, resolveAccountId } from '../utils/accountId'

const ACTIONS = ['get', 'update', 'delete']

// The same checks run for creates in turnstile_widgets.post.js; keep the two in step.
const MODES = ['managed', 'non-interactive', 'invisible']
const CLEARANCE_LEVELS = ['no_clearance', 'jschallenge', 'managed', 'interactive']
const REGIONS = ['world', 'china']

// Cloudflare's update is a PUT that replaces the whole widget, so name, domains and mode are
// required even when only one setting changed.
const readWidget = (body) => {
	const widget = readAccountPayload(body, 'widget', 'Widget')
	return {
		...widget,
		name: accountFields.text(widget.name, 'Name', { max: 254 }),
		domains: accountFields.list(widget.domains, 'Domains', { max: 200 }),
		mode: accountFields.oneOf(widget.mode, 'Mode', MODES, { required: true }),
		clearance_level: accountFields.oneOf(widget.clearance_level, 'Clearance level', CLEARANCE_LEVELS),
		region: accountFields.oneOf(widget.region, 'Region', REGIONS),
		bot_fight_mode: accountFields.boolean(widget.bot_fight_mode, 'Bot Fight Mode'),
		ephemeral_id: accountFields.boolean(widget.ephemeral_id, 'Ephemeral ID'),
		offlabel: accountFields.boolean(widget.offlabel, 'Offlabel')
	}
}

// Body: { apiKey, currZone, sitekey, action?: 'get' | 'update' | 'delete', widget? }
export default defineEventHandler(async (event) => {
	try {
		const request = await readAccountBody(event, { idKey: 'sitekey', idLabel: 'Sitekey' })
		const action = request.body.action || 'get'
		if (!ACTIONS.includes(action)) {
			throw createError({ statusCode: 400, statusMessage: 'Action must be get, update or delete' })
		}

		const widget = action === 'update' ? readWidget(request.body) : null

		const { accountId, failure } = await resolveAccountId(request)
		if (failure) return failure

		const listPath = `/accounts/${accountId}/challenges/widgets`
		const path = `${listPath}/${request.id}`

		if (action === 'get') {
			return await cfFetch({ apiKey: request.apiKey, method: 'GET', path })
		}

		const data = await cfFetch({
			apiKey: request.apiKey,
			method: action === 'update' ? 'PUT' : 'DELETE',
			path,
			body: widget || undefined
		})
		if (data?.success) invalidateCfCache({ apiKey: request.apiKey, paths: [listPath] })
		return data
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
