import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { buildCloudflareDnsPayload } from '../../utils/dnsEditor'
import { cfFetch, invalidateCfCache } from '../../utils/cfFetch'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		if (!body.currZone) {
			throw createError({ statusCode: 400, statusMessage: 'Zone ID is required' })
		}

		if (!Array.isArray(body.changes)) {
			throw createError({ statusCode: 400, statusMessage: 'Changes are required' })
		}

		const zoneData = await cfFetch({
			apiKey: body.apiKey,
			method: 'GET',
			path: `/zones/${body.currZone}`,
			cacheTtl: 15000
		})

		if (!zoneData?.success || !zoneData?.result?.name) {
			throw createError({
				statusCode: 502,
				statusMessage: zoneData?.errors?.[0]?.message || 'Failed to load zone details'
			})
		}

		const results = []
		let created = 0
		let updated = 0
		let failed = 0

		for (const change of body.changes) {
			if (!change || (change.action !== 'create' && change.action !== 'update')) continue

			const payload = buildCloudflareDnsPayload({ ...change, zoneName: zoneData.result.name })
			if (!payload) {
				failed += 1
				results.push({
					action: change.action,
					type: change.type,
					name: change.name,
					success: false,
					message: 'Unsupported or invalid DNS record'
				})
				continue
			}

			if (change.action === 'update' && !change.existingRecordId) {
				failed += 1
				results.push({
					action: change.action,
					type: change.type,
					name: payload.name,
					success: false,
					message: 'Missing record ID for update'
				})
				continue
			}

			const response = await cfFetch({
				apiKey: body.apiKey,
				method: change.action === 'update' ? 'PUT' : 'POST',
				path:
					change.action === 'update'
						? `/zones/${body.currZone}/dns_records/${change.existingRecordId}`
						: `/zones/${body.currZone}/dns_records`,
				body: payload
			})

			if (response?.success) {
				if (change.action === 'update') updated += 1
				else created += 1
				results.push({
					action: change.action,
					type: payload.type,
					name: payload.name,
					success: true,
					result: response.result
				})
				continue
			}

			failed += 1
			results.push({
				action: change.action,
				type: payload.type,
				name: payload.name,
				success: false,
				message: response?.errors?.[0]?.message || 'Cloudflare rejected the change'
			})
		}

		if (created > 0 || updated > 0) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [`/zones/${body.currZone}`] })
		}

		return {
			success: failed === 0,
			result: {
				created,
				updated,
				failed,
				results
			}
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Failed to apply AI DNS changes'
		})
	}
})
