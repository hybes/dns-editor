import { isIP } from 'node:net'
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
// the stored list so the new cluster appears straight away.
const LIST_CACHE_TTL_MS = 15_000

// Cloudflare's limits. The same checks run for updates in dns_firewall_cluster.post.js; keep
// the two in step.
const TTL_RANGE = { min: 30, max: 36_000 }
const RATELIMIT_RANGE = { min: 100, max: 1_000_000_000 }
const RETRIES_RANGE = { min: 0, max: 2 }

const badRequest = (statusMessage) => createError({ statusCode: 400, statusMessage })

const readUpstreamIps = (value) => {
	const ips = accountFields.list(value, 'Upstream IPs')
	const invalid = ips.find((ip) => !isIP(ip))
	if (invalid !== undefined) throw badRequest(`Upstream IPs: “${invalid}” isn’t an IPv4 or IPv6 address`)
	return ips
}

// Cloudflare accepts null for the numeric settings of a new cluster and uses its default.
const optionalInteger = (value, label, range) => (value === null ? null : accountFields.integer(value, label, range))

const readAttackMitigation = (value) => {
	if (value === undefined || value === null) return value
	if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('Attack mitigation must be a JSON object')
	return {
		...value,
		enabled: accountFields.boolean(value.enabled, 'Attack mitigation'),
		only_when_upstream_unhealthy: accountFields.boolean(
			value.only_when_upstream_unhealthy,
			'Only when upstream servers seem unhealthy'
		)
	}
}

const readCluster = (body) => {
	const cluster = readAccountPayload(body, 'cluster', 'Cluster')
	const clean = {
		...cluster,
		name: accountFields.text(cluster.name, 'Name', { max: 160 }),
		upstream_ips: readUpstreamIps(cluster.upstream_ips),
		minimum_cache_ttl: optionalInteger(cluster.minimum_cache_ttl, 'Minimum cache TTL', TTL_RANGE),
		maximum_cache_ttl: optionalInteger(cluster.maximum_cache_ttl, 'Maximum cache TTL', TTL_RANGE),
		negative_cache_ttl: optionalInteger(cluster.negative_cache_ttl, 'Negative cache TTL', TTL_RANGE),
		ratelimit: optionalInteger(cluster.ratelimit, 'Rate limit', RATELIMIT_RANGE),
		retries: optionalInteger(cluster.retries, 'Retries', RETRIES_RANGE),
		ecs_fallback: accountFields.boolean(cluster.ecs_fallback, 'EDNS Client Subnet fallback'),
		deprecate_any_requests: accountFields.boolean(cluster.deprecate_any_requests, 'Refuse ANY queries'),
		attack_mitigation: readAttackMitigation(cluster.attack_mitigation),
		dns_firewall_ip_count: optionalInteger(cluster.dns_firewall_ip_count, 'DNS Firewall IP count', {
			min: 1,
			max: 10
		})
	}
	if (
		typeof clean.minimum_cache_ttl === 'number' &&
		typeof clean.maximum_cache_ttl === 'number' &&
		clean.minimum_cache_ttl > clean.maximum_cache_ttl
	) {
		throw badRequest('Minimum cache TTL can’t be more than the maximum cache TTL')
	}
	return clean
}

// Body: { apiKey, currZone, action?: 'list' | 'create', page?, per_page?, fresh?, cluster? }
export default defineEventHandler(async (event) => {
	try {
		const request = await readAccountBody(event)
		const action = request.body.action || 'list'
		if (action !== 'list' && action !== 'create') {
			throw createError({ statusCode: 400, statusMessage: 'Action must be list or create' })
		}

		// Check the input before looking up the account, so bad input fails fast.
		const cluster = action === 'create' ? readCluster(request.body) : null
		const query = action === 'list' ? accountListQuery(request.body, { minPerPage: 1, maxPerPage: 100 }) : ''

		const { accountId, failure } = await resolveAccountId(request)
		if (failure) return failure

		const path = `/accounts/${accountId}/dns_firewall`

		if (action === 'list') {
			return await cfFetch({
				apiKey: request.apiKey,
				method: 'GET',
				path: `${path}${query}`,
				cacheTtl: LIST_CACHE_TTL_MS,
				fresh: request.body.fresh === true
			})
		}

		const created = await cfFetch({ apiKey: request.apiKey, method: 'POST', path, body: cluster })
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
