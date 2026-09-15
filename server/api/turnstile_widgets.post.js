import { createError } from 'h3'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
import {
	accountFields,
	accountListQuery,
	readAccountBody,
	readAccountPayload,
	resolveAccountId
} from '../utils/accountId'

// Keeps revisits quick. The page sends `fresh` when the user refreshes, and a create clears
// the stored list so the new widget appears straight away.
const LIST_CACHE_TTL_MS = 15_000

// The same checks run for updates in turnstile_widget.post.js; keep the two in step.
const MODES = ['managed', 'non-interactive', 'invisible']
const CLEARANCE_LEVELS = ['no_clearance', 'jschallenge', 'managed', 'interactive']
const REGIONS = ['world', 'china']

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

// Body: { apiKey, currZone, action?: 'list' | 'create', page?, per_page?, fresh?, widget? }
export default defineEventHandler(async (event) => {
	try {
		const request = await readAccountBody(event)
		const action = request.body.action || 'list'
		if (action !== 'list' && action !== 'create') {
			throw createError({ statusCode: 400, statusMessage: 'Action must be list or create' })
		}

		// Check the input before looking up the account, so bad input fails fast.
		const widget = action === 'create' ? readWidget(request.body) : null
		const query = action === 'list' ? accountListQuery(request.body, { minPerPage: 5, maxPerPage: 1000 }) : ''

		const { accountId, failure } = await resolveAccountId(request)
		if (failure) return failure

		const path = `/accounts/${accountId}/challenges/widgets`

		if (action === 'list') {
			return await cfFetch({
				apiKey: request.apiKey,
				method: 'GET',
				path: `${path}${query}`,
				cacheTtl: LIST_CACHE_TTL_MS,
				fresh: request.body.fresh === true
			})
		}

		const created = await cfFetch({ apiKey: request.apiKey, method: 'POST', path, body: widget })
		if (created?.success) invalidateCfCache({ apiKey: request.apiKey, paths: [path] })
		return created
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
