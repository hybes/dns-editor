import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)
		const bodyToSend = {}

		if (body.data) {
			if (!body.data.service || !body.data.proto || !body.data.name || !body.data.target) {
				throw createError({
					statusCode: 400,
					statusMessage: 'Missing required SRV fields (service, proto, name, target)'
				})
			}

			bodyToSend.data = body.data

			if (body.data.port) bodyToSend.data.port = Number(body.data.port)
			if (body.data.priority) bodyToSend.data.priority = Number(body.data.priority)
			if (body.data.weight) bodyToSend.data.weight = Number(body.data.weight)

			const dnsName = body.data.service + '.' + body.data.proto + '.' + body.data.name
			bodyToSend.name = dnsName
			bodyToSend.type = 'SRV'
			bodyToSend.ttl = 1
		} else if (body.dns) {
			if (!body.dns.type) {
				throw createError({ statusCode: 400, statusMessage: 'Record type is required' })
			}

			if (body.dns.type !== 'SRV') {
				if (!body.dns.name || !body.dns.content) {
					throw createError({ statusCode: 400, statusMessage: 'Name and content are required' })
				}

				bodyToSend.content = body.dns.content
				bodyToSend.name = body.dns.name
				bodyToSend.proxied = body.dns.proxied || false
				bodyToSend.type = body.dns.type
				bodyToSend.comment = body.dns.comment || ''
				bodyToSend.ttl = Number.isInteger(body.dns.ttl) ? body.dns.ttl : Number(body.dns.ttl) || 1
			}

			if (body.dns.priority !== undefined) {
				bodyToSend.priority = Number(body.dns.priority) || 0
			}
		} else {
			throw createError({ statusCode: 400, statusMessage: 'Invalid request: missing DNS data' })
		}

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		if (!body.currZone) {
			throw createError({ statusCode: 400, statusMessage: 'Zone ID is required' })
		}

		const result = await cfFetch({
			apiKey: body.apiKey,
			method: 'POST',
			path: `/zones/${body.currZone}/dns_records/`,
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
