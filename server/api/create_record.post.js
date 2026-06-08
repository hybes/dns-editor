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

			// Valid SRV names require the _service._proto.name convention. The client may
			// send service/proto with or without the leading underscore, so normalise here.
			const withUnderscore = (value) => {
				const str = String(value)
				return str.startsWith('_') ? str : `_${str}`
			}
			const service = withUnderscore(body.data.service)
			const proto = withUnderscore(body.data.proto)

			bodyToSend.data = { ...body.data, service, proto }

			// Coerce by presence, not truthiness, so a legitimate 0 isn't dropped as a string.
			const toNumber = (value) =>
				value === undefined || value === null || value === '' ? undefined : Number(value)
			const port = toNumber(body.data.port)
			const priority = toNumber(body.data.priority)
			const weight = toNumber(body.data.weight)
			if (port !== undefined) bodyToSend.data.port = port
			if (priority !== undefined) bodyToSend.data.priority = priority
			if (weight !== undefined) bodyToSend.data.weight = weight

			bodyToSend.name = `${service}.${proto}.${body.data.name}`
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
