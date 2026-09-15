import { isIP } from 'node:net'
import { createError } from 'h3'
import { cfFetch, invalidateCfCache } from '../utils/cfFetch'
import { accountFields, readAccountBody, readAccountPayload, resolveAccountId } from '../utils/accountId'

const ACTIONS = ['get', 'update', 'delete']

// Cloudflare's limits. The same checks run for creates in dns_firewall_clusters.post.js; keep
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

// Rate limit and negative cache TTL can be cleared with null; the other numbers can't.
const clearableInteger = (value, label, range) => (value === null ? null : accountFields.integer(value, label, range))

const readAttackMitigation = (value) => {
	if (value === undefined) return undefined
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw badRequest('Attack mitigation must be a JSON object')
	}
	return {
		...value,
		enabled: accountFields.boolean(value.enabled, 'Attack mitigation'),
		only_when_upstream_unhealthy: accountFields.boolean(
			value.only_when_upstream_unhealthy,
			'Only when upstream servers seem unhealthy'
		)
	}
}

// Cloudflare's update is a PATCH, so only the fields being changed are sent and checked.
const readChanges = (body) => {
	const cluster = readAccountPayload(body, 'cluster', 'Cluster')
	if (!Object.keys(cluster).length) throw badRequest('There are no changes to save')
	if (cluster.dns_firewall_ip_count !== undefined) {
		throw badRequest('DNS Firewall IP count can only be set when the cluster is created')
	}

	const clean = {
		...cluster,
		minimum_cache_ttl: accountFields.integer(cluster.minimum_cache_ttl, 'Minimum cache TTL', TTL_RANGE),
		maximum_cache_ttl: accountFields.integer(cluster.maximum_cache_ttl, 'Maximum cache TTL', TTL_RANGE),
		negative_cache_ttl: clearableInteger(cluster.negative_cache_ttl, 'Negative cache TTL', TTL_RANGE),
		ratelimit: clearableInteger(cluster.ratelimit, 'Rate limit', RATELIMIT_RANGE),
		retries: accountFields.integer(cluster.retries, 'Retries', RETRIES_RANGE),
		ecs_fallback: accountFields.boolean(cluster.ecs_fallback, 'EDNS Client Subnet fallback'),
		deprecate_any_requests: accountFields.boolean(cluster.deprecate_any_requests, 'Refuse ANY queries'),
		attack_mitigation: readAttackMitigation(cluster.attack_mitigation)
	}
	if (cluster.name !== undefined) clean.name = accountFields.text(cluster.name, 'Name', { max: 160 })
	if (cluster.upstream_ips !== undefined) clean.upstream_ips = readUpstreamIps(cluster.upstream_ips)

	// Only comparable when both change together; the page checks against the stored values.
	if (
		typeof clean.minimum_cache_ttl === 'number' &&
		typeof clean.maximum_cache_ttl === 'number' &&
		clean.minimum_cache_ttl > clean.maximum_cache_ttl
	) {
		throw badRequest('Minimum cache TTL can’t be more than the maximum cache TTL')
	}
	return clean
}

// Body: { apiKey, currZone, clusterId, action?: 'get' | 'update' | 'delete', cluster? }
export default defineEventHandler(async (event) => {
	try {
		const request = await readAccountBody(event, { idKey: 'clusterId', idLabel: 'Cluster ID' })
		const action = request.body.action || 'get'
		if (!ACTIONS.includes(action)) {
			throw createError({ statusCode: 400, statusMessage: 'Action must be get, update or delete' })
		}

		const changes = action === 'update' ? readChanges(request.body) : null

		const { accountId, failure } = await resolveAccountId(request)
		if (failure) return failure

		const listPath = `/accounts/${accountId}/dns_firewall`
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
		// The prefix also clears the paginated list the page reads.
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
