import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.dns || !body.dns.type) {
			throw createError({ statusCode: 400, statusMessage: "Invalid DNS data: 'type' is required" })
		}

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		if (!body.currZone) {
			throw createError({ statusCode: 400, statusMessage: 'Zone ID is required' })
		}

		if (!body.currDnsRecord) {
			throw createError({ statusCode: 400, statusMessage: 'DNS record ID is required' })
		}

		const bodyToSend = {
			type: body.dns.type,
			comment: body.dns.comment || '',
			ttl: Number.isInteger(body.dns.ttl) ? body.dns.ttl : Number(body.dns.ttl) || 1
		}

		if (body.dns.type === 'SRV') {
			if (!body.dns.data) {
				throw createError({ statusCode: 400, statusMessage: 'Missing SRV data' })
			}

			bodyToSend.data = body.dns.data
			bodyToSend.name = body.dns.name

			if (body.dns.data.port) bodyToSend.data.port = Number(body.dns.data.port)
			if (body.dns.data.priority) bodyToSend.data.priority = Number(body.dns.data.priority)
			if (body.dns.data.weight) bodyToSend.data.weight = Number(body.dns.data.weight)

			if (body.dns.priority !== undefined) {
				bodyToSend.priority = Number(body.dns.priority) || 0
			}
		} else {
			bodyToSend.content = body.dns.content
			bodyToSend.name = body.dns.name
			bodyToSend.proxied = body.dns.proxied

			if (body.dns.priority !== undefined) {
				bodyToSend.priority = Number(body.dns.priority) || 0
			}
		}

		const result = await cfFetch({
			apiKey: body.apiKey,
			method: 'PUT',
			path: `/zones/${body.currZone}/dns_records/${body.currDnsRecord}`,
			body: bodyToSend
		})

		if (result?.success) {
			invalidateCfCache({ apiKey: body.apiKey, paths: [`/zones/${body.currZone}`] })
		}

		return result
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
