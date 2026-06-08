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

			const withUnderscore = (value) => {
				const str = String(value)
				return str.startsWith('_') ? str : `_${str}`
			}
			bodyToSend.data = { ...body.dns.data }
			if (body.dns.data.service) bodyToSend.data.service = withUnderscore(body.dns.data.service)
			if (body.dns.data.proto) bodyToSend.data.proto = withUnderscore(body.dns.data.proto)
			bodyToSend.name = body.dns.name

			const toNumber = (value) =>
				value === undefined || value === null || value === '' ? undefined : Number(value)
			const port = toNumber(body.dns.data.port)
			const priority = toNumber(body.dns.data.priority)
			const weight = toNumber(body.dns.data.weight)
			if (port !== undefined) bodyToSend.data.port = port
			if (priority !== undefined) bodyToSend.data.priority = priority
			if (weight !== undefined) bodyToSend.data.weight = weight

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
