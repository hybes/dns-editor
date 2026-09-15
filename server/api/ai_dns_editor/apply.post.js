import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { buildCloudflareDnsPayload } from '../../utils/dnsEditor'
import { isCloudflareId, readId } from '../../utils/ids'
import { cfFetch, invalidateCfCache } from '../../utils/cfFetch'

const MAX_CHANGES = 100

// An in-place update only changes the value, the MX priority and an explicit TTL. PATCH
// leaves the record's proxy status, comment, tags and settings as they are, where a PUT
// would overwrite them. The planner uses TTL 1 (automatic) when the paste gave none.
const updateBody = (payload) => {
	const patch = { content: payload.content }
	if (payload.priority !== undefined) patch.priority = payload.priority
	if (payload.ttl !== 1) patch.ttl = payload.ttl
	return patch
}

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		if (!Array.isArray(body.changes) || !body.changes.length) {
			throw createError({ statusCode: 400, statusMessage: 'Choose at least one change to apply' })
		}

		if (body.changes.length > MAX_CHANGES) {
			throw createError({ statusCode: 400, statusMessage: `Apply up to ${MAX_CHANGES} changes at a time` })
		}

		const zoneData = await cfFetch({
			apiKey: body.apiKey,
			method: 'GET',
			path: `/zones/${zoneId}`,
			cacheTtl: 15000
		})

		if (!zoneData?.success || !zoneData?.result?.name) {
			return {
				success: false,
				errors: zoneData?.errors?.length
					? zoneData.errors
					: [{ message: 'Couldn’t load this zone from Cloudflare' }]
			}
		}

		// Each result echoes the change's `key` so the page can show the outcome next to it.
		const results = []
		const fail = (change, message, code) =>
			results.push({
				key: change?.key ?? null,
				action: change?.action,
				type: change?.type,
				name: change?.name,
				success: false,
				message,
				code
			})

		// One at a time, so a CNAME update and another record at the same name can't race.
		for (const change of body.changes) {
			if (!change || (change.action !== 'create' && change.action !== 'update')) {
				fail(change, 'Only create and update changes can be applied')
				continue
			}

			const payload = buildCloudflareDnsPayload({ ...change, zoneName: zoneData.result.name })
			if (!payload) {
				fail(change, 'This record is incomplete or its type isn’t supported')
				continue
			}

			const isUpdate = change.action === 'update'
			if (isUpdate && !isCloudflareId(change.existingRecordId)) {
				fail(change, 'The record to update has no ID. Analyse the instructions again.')
				continue
			}

			// A network failure only fails this change, so the changes already made are still
			// reported and the cache below is still cleared.
			let response
			try {
				response = await cfFetch({
					apiKey: body.apiKey,
					method: isUpdate ? 'PATCH' : 'POST',
					path: isUpdate
						? `/zones/${zoneId}/dns_records/${change.existingRecordId}`
						: `/zones/${zoneId}/dns_records`,
					body: isUpdate ? updateBody(payload) : payload
				})
			} catch (error) {
				fail(
					{ ...change, type: payload.type, name: payload.name },
					error?.message || 'Cloudflare didn’t respond'
				)
				continue
			}

			if (response?.success) {
				results.push({
					key: change.key ?? null,
					action: change.action,
					type: payload.type,
					name: payload.name,
					success: true,
					result: response.result
				})
				continue
			}

			const error = response?.errors?.[0]
			fail(
				{ ...change, type: payload.type, name: payload.name },
				error?.message || 'Cloudflare rejected the change',
				error?.code
			)
		}

		const created = results.filter((item) => item.success && item.action === 'create').length
		const updated = results.filter((item) => item.success && item.action === 'update').length
		const failures = results.filter((item) => !item.success)

		if (created + updated > 0) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [`/zones/${zoneId}`] })
		}

		// success:false whenever any change failed, so a partial apply can't pass for a full one.
		// The per-change results carry each reason.
		return {
			success: failures.length === 0,
			errors: failures.length
				? [
						{
							code: failures[0].code,
							message: `${failures.length} of ${results.length} changes failed: ${failures[0].message}`
						}
					]
				: [],
			result: { created, updated, failed: failures.length, results }
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: `Couldn’t apply the changes: ${error?.message || 'unknown error'}`
		})
	}
})
