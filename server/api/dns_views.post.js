import { createError } from 'h3'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
import {
	accountFields,
	accountListQuery,
	readAccountBody,
	readAccountPayload,
	resolveAccountId
} from '../utils/accountId'
import { isCloudflareId } from '../utils/ids'

// Keeps revisits quick. The page sends `fresh` when the user refreshes, and a create clears
// the stored list so the new view appears straight away.
const LIST_CACHE_TTL_MS = 15_000

const ACTIONS = ['list', 'create', 'internal_zones']

// Views can only link internal zones, and Cloudflare leaves those out of GET /zones unless
// asked, so the zone list the rest of the app uses never contains them.
const ZONE_PAGE_SIZE = 50
// 1,000 internal zones; the page offers pasting an ID for any beyond that.
const MAX_ZONE_PAGES = 20

// The same checks run for updates in dns_view.post.js; keep the two in step.
// Set by Cloudflare, so dropped if a client echoes them back from a fetched view.
const READ_ONLY_FIELDS = ['id', 'created_time', 'modified_time']

const badRequest = (statusMessage) => createError({ statusCode: 400, statusMessage })

const readZones = (value) => {
	const zones = accountFields.list(value, 'Zones', { min: 0 })
	const invalid = zones.find((id) => !isCloudflareId(id))
	if (invalid !== undefined) throw badRequest(`Zones: “${invalid}” isn’t a valid zone ID`)
	return [...new Set(zones)]
}

// A view can be created empty, so only the name is required.
const readView = (body) => {
	const view = readAccountPayload(body, 'view', 'View')
	const fields = Object.fromEntries(Object.entries(view).filter(([key]) => !READ_ONLY_FIELDS.includes(key)))
	const cleaned = { ...fields, name: accountFields.text(view.name, 'Name', { max: 255 }) }
	if (view.zones !== undefined) cleaned.zones = readZones(view.zones)
	return cleaned
}

const noZoneList = (page) => ({
	success: false,
	errors: [{ message: `Cloudflare returned nothing for page ${page} of the internal zone list. Try again.` }]
})

// Every internal zone in the account, trimmed to what the view form needs. One failed page
// fails the whole list, because a partial list would quietly hide zones from the picker.
const listInternalZones = async ({ apiKey, accountId, fresh }) => {
	const zones = new Map()
	let totalCount = 0

	for (let page = 1; page <= MAX_ZONE_PAGES; page++) {
		const query = `type=internal&account.id=${encodeURIComponent(accountId)}&page=${page}&per_page=${ZONE_PAGE_SIZE}`
		const data = await cfFetch({
			apiKey,
			method: 'GET',
			path: `/zones?${query}`,
			cacheTtl: LIST_CACHE_TTL_MS,
			fresh
		})
		if (!data?.success) return data || noZoneList(page)

		for (const zone of data.result || []) {
			if (zone?.id) zones.set(zone.id, { id: zone.id, name: zone.name || '', status: zone.status || '' })
		}
		totalCount = Number(data.result_info?.total_count) || 0
		if (page >= (Number(data.result_info?.total_pages) || 1)) break
	}

	const result = [...zones.values()].sort((a, b) => a.name.localeCompare(b.name))
	return {
		success: true,
		errors: [],
		messages: [],
		result,
		result_info: { count: result.length, total_count: Math.max(totalCount, result.length) }
	}
}

// Body: { apiKey, currZone, action?: 'list' | 'create' | 'internal_zones', page?, per_page?, fresh?, view? }
export default defineEventHandler(async (event) => {
	try {
		const request = await readAccountBody(event)
		const action = request.body.action || 'list'
		if (!ACTIONS.includes(action)) {
			throw badRequest('Action must be list, create or internal_zones')
		}

		// Check the input before looking up the account, so bad input fails fast.
		const view = action === 'create' ? readView(request.body) : null
		const query = action === 'list' ? accountListQuery(request.body, { maxPerPage: 5000 }) : ''

		const { accountId, failure } = await resolveAccountId(request)
		if (failure) return failure

		const fresh = request.body.fresh === true

		if (action === 'internal_zones') {
			return await listInternalZones({ apiKey: request.apiKey, accountId, fresh })
		}

		const path = `/accounts/${accountId}/dns_settings/views`

		if (action === 'list') {
			return await cfFetch({
				apiKey: request.apiKey,
				method: 'GET',
				path: `${path}${query}`,
				cacheTtl: LIST_CACHE_TTL_MS,
				fresh
			})
		}

		const created = await cfFetch({ apiKey: request.apiKey, method: 'POST', path, body: view })
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
