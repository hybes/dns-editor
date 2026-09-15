import { createError } from 'h3'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
import { accountFields, readAccountBody, readAccountPayload, resolveAccountId } from '../utils/accountId'
import { isCloudflareId } from '../utils/ids'

const ACTIONS = ['get', 'update', 'delete']

// The same checks run for creates in dns_views.post.js; keep the two in step.
// Set by Cloudflare, so dropped if a client echoes them back from a fetched view.
const READ_ONLY_FIELDS = ['id', 'created_time', 'modified_time']

const badRequest = (statusMessage) => createError({ statusCode: 400, statusMessage })

const readZones = (value) => {
	const zones = accountFields.list(value, 'Zones', { min: 0 })
	const invalid = zones.find((id) => !isCloudflareId(id))
	if (invalid !== undefined) throw badRequest(`Zones: “${invalid}” isn’t a valid zone ID`)
	return [...new Set(zones)]
}

// Cloudflare's update is a PATCH, so only the fields being changed are sent and checked.
const readChanges = (body) => {
	const view = readAccountPayload(body, 'view', 'View')
	const changes = Object.fromEntries(Object.entries(view).filter(([key]) => !READ_ONLY_FIELDS.includes(key)))
	if (changes.name !== undefined) changes.name = accountFields.text(changes.name, 'Name', { max: 255 })
	if (changes.zones !== undefined) changes.zones = readZones(changes.zones)
	if (!Object.keys(changes).length) throw badRequest('View must include at least one field to change')
	return changes
}

// Body: { apiKey, currZone, viewId, action?: 'get' | 'update' | 'delete', view? }
export default defineEventHandler(async (event) => {
	try {
		const request = await readAccountBody(event, { idKey: 'viewId', idLabel: 'View ID' })
		const action = request.body.action || 'get'
		if (!ACTIONS.includes(action)) {
			throw badRequest('Action must be get, update or delete')
		}

		const changes = action === 'update' ? readChanges(request.body) : null

		const { accountId, failure } = await resolveAccountId(request)
		if (failure) return failure

		const listPath = `/accounts/${accountId}/dns_settings/views`
		const path = `${listPath}/${request.id}`

		if (action === 'get') {
			return await cfFetch({ apiKey: request.apiKey, method: 'GET', path })
		}

		const data = await cfFetch({
			apiKey: request.apiKey,
			method: action === 'update' ? 'PATCH' : 'DELETE',
			path,
			body: changes || undefined
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
