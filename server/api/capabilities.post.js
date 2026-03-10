import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const probe = async (path, featureName) => {
			const data = await cfFetch({ apiKey: body.apiKey, method: 'GET', path, cacheTtl: 60000 })
			if (data && data.success) return { available: true, reason: '' }
			return {
				available: false,
				reason:
					(data && data.errors && data.errors[0] && data.errors[0].message) || `${featureName} unavailable`
			}
		}

		const probeGraphql = async (query, variables, featureName) => {
			const data = await cfFetch({
				apiKey: body.apiKey,
				method: 'POST',
				path: '/graphql',
				body: { query, variables }
			})
			if (data && !data.errors) return { available: true, reason: '' }
			return {
				available: false,
				reason:
					(data && data.errors && data.errors[0] && data.errors[0].message) || `${featureName} unavailable`
			}
		}

		const probeRulesets = async (zoneId) => {
			const list = await cfFetch({
				apiKey: body.apiKey,
				method: 'GET',
				path: `/zones/${zoneId}/rulesets?per_page=1`,
				cacheTtl: 60000
			})
			if (!list || !list.success) {
				return {
					available: false,
					reason: (list && list.errors && list.errors[0] && list.errors[0].message) || 'Rulesets unavailable'
				}
			}

			const first = (list.result && list.result[0]) || null
			if (!first || !first.id) return { available: true, reason: '' }

			const detail = await cfFetch({
				apiKey: body.apiKey,
				method: 'GET',
				path: `/zones/${zoneId}/rulesets/${first.id}`,
				cacheTtl: 60000
			})
			if (detail && detail.success) return { available: true, reason: '' }

			return {
				available: false,
				reason:
					(detail && detail.errors && detail.errors[0] && detail.errors[0].message) || 'Rulesets unavailable'
			}
		}

		const result = {}

		result.zones = await probe('/zones', 'Zones')

		if (body.currZone) {
			const zoneData = await cfFetch({
				apiKey: body.apiKey,
				method: 'GET',
				path: `/zones/${body.currZone}`,
				cacheTtl: 60000
			})
			result.zone =
				zoneData && zoneData.success
					? { available: true, reason: '' }
					: {
							available: false,
							reason:
								(zoneData && zoneData.errors && zoneData.errors[0] && zoneData.errors[0].message) ||
								'Zone unavailable'
						}

			result.dns = await probe(`/zones/${body.currZone}/dns_records?per_page=1`, 'DNS')
			result.ssl = await probe(`/zones/${body.currZone}/settings/ssl`, 'SSL')
			result.rulesets = await probeRulesets(body.currZone)
			result.botFightMode = await probe(`/zones/${body.currZone}/bot_management`, 'Bot Management')

			const accountId =
				zoneData && zoneData.success && zoneData.result && zoneData.result.account && zoneData.result.account.id
					? zoneData.result.account.id
					: ''

			if (accountId) {
				result.turnstile = await probe(`/accounts/${accountId}/challenges/widgets`, 'Turnstile')
				result.dnsViews = await probe(`/accounts/${accountId}/dns_settings/views`, 'DNS Views')
				result.dnsFirewall = await probe(`/accounts/${accountId}/dns_firewall`, 'DNS Firewall')
				result.accountAnalytics = await probeGraphql(
					'query ($accountTag: string!, $date_geq: Date!, $date_leq: Date!) { viewer { accounts(filter: { accountTag: $accountTag }) { dnsAnalyticsAdaptiveGroups(filter: { date_geq: $date_geq, date_leq: $date_leq } limit: 1) { count } } } }',
					{ accountTag: accountId, date_geq: '2025-01-01', date_leq: '2025-01-02' },
					'Account Analytics'
				)
			} else {
				result.turnstile = { available: false, reason: 'Account required' }
				result.dnsViews = { available: false, reason: 'Account required' }
				result.dnsFirewall = { available: false, reason: 'Account required' }
				result.accountAnalytics = { available: false, reason: 'Account required' }
			}
		} else {
			result.zone = { available: false, reason: 'Zone required' }
			result.dns = { available: false, reason: 'Zone required' }
			result.ssl = { available: false, reason: 'Zone required' }
			result.rulesets = { available: false, reason: 'Zone required' }
			result.botFightMode = { available: false, reason: 'Zone required' }
			result.turnstile = { available: false, reason: 'Zone required' }
			result.dnsViews = { available: false, reason: 'Zone required' }
			result.dnsFirewall = { available: false, reason: 'Zone required' }
			result.accountAnalytics = { available: false, reason: 'Zone required' }
		}

		return { success: true, result }
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
