import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'
import { readId } from '../utils/ids'

const CACHE_TTL = 60000
const AVAILABLE = { available: true, reason: '' }
const ANALYTICS_QUERY =
	'query ($accountTag: String!, $date_geq: Date!, $date_leq: Date!) { viewer { accounts(filter: { accountTag: $accountTag }) { dnsAnalyticsAdaptiveGroups(filter: { date_geq: $date_geq, date_leq: $date_leq } limit: 1) { count } } } }'

const ZONE_ANALYTICS_QUERY =
	'query ($zoneTag: String!) { viewer { zones(filter: { zoneTag: $zoneTag }) { settings { dnsAnalyticsAdaptiveGroups { enabled } } } } }'

const unavailable = (reason) => ({ available: false, reason })
const reasonFrom = (data, fallback) => data?.errors?.[0]?.message || fallback
const isoDate = (date) => date.toISOString().slice(0, 10)

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, statusMessage: 'API key is required' })
		}

		const get = (path) => cfFetch({ apiKey: body.apiKey, method: 'GET', path, cacheTtl: CACHE_TTL })

		const probe = async (path, featureName) => {
			const data = await get(path)
			return data?.success ? AVAILABLE : unavailable(reasonFrom(data, `${featureName} unavailable`))
		}

		// Listing rulesets can succeed while reading one is forbidden, so check both.
		const probeRulesets = async (zoneId) => {
			const list = await get(`/zones/${zoneId}/rulesets?per_page=1`)
			if (!list?.success) return unavailable(reasonFrom(list, 'Rulesets unavailable'))
			const first = list.result?.[0]
			if (!first?.id) return AVAILABLE
			const detail = await get(`/zones/${zoneId}/rulesets/${first.id}`)
			return detail?.success ? AVAILABLE : unavailable(reasonFrom(detail, 'Rulesets unavailable'))
		}

		// GraphQL reports permission problems in `errors` alongside HTTP 200.
		const graphql = (query, variables) =>
			cfFetch({ apiKey: body.apiKey, method: 'POST', path: '/graphql', body: { query, variables } })

		// The Analytics page reads the zone's own DNS analytics first and falls back to the
		// account's, so the feature is available when either one can be read.
		const probeAnalytics = async (zoneId, accountId) => {
			const zone = await graphql(ZONE_ANALYTICS_QUERY, { zoneTag: zoneId })
			const zoneSettings = zone?.data?.viewer?.zones?.[0]?.settings?.dnsAnalyticsAdaptiveGroups
			if (zone && !zone.errors && zoneSettings?.enabled) return AVAILABLE
			if (!accountId) return unavailable(reasonFrom(zone, 'DNS analytics unavailable'))

			const today = new Date()
			const yesterday = new Date(today.getTime() - 86_400_000)
			const account = await graphql(ANALYTICS_QUERY, {
				accountTag: accountId,
				date_geq: isoDate(yesterday),
				date_leq: isoDate(today)
			})
			return account && !account.errors
				? AVAILABLE
				: unavailable(reasonFrom(account, reasonFrom(zone, 'DNS analytics unavailable')))
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		const zoneData = await get(`/zones/${zoneId}`)
		const accountId = zoneData?.success ? zoneData.result?.account?.id || '' : ''
		// When the zone can't be read, its error explains why account features can't be checked.
		const accountReason = zoneData?.success
			? 'Cloudflare didn’t return an account for this zone'
			: reasonFrom(zoneData, 'Couldn’t look up this zone’s account')
		const forAccount = (task) => (accountId ? task() : Promise.resolve(unavailable(accountReason)))

		const [zones, dns, ssl, rulesets, botFightMode, turnstile, dnsViews, dnsFirewall, accountAnalytics] =
			await Promise.all([
				probe('/zones', 'Zones'),
				probe(`/zones/${zoneId}/dns_records?per_page=1`, 'DNS'),
				probe(`/zones/${zoneId}/settings/ssl`, 'SSL'),
				probeRulesets(zoneId),
				probe(`/zones/${zoneId}/bot_management`, 'Bot Management'),
				forAccount(() => probe(`/accounts/${accountId}/challenges/widgets`, 'Turnstile')),
				forAccount(() => probe(`/accounts/${accountId}/dns_settings/views`, 'DNS Views')),
				forAccount(() => probe(`/accounts/${accountId}/dns_firewall`, 'DNS Firewall')),
				probeAnalytics(zoneId, accountId)
			])

		return {
			success: true,
			result: {
				zones,
				zone: zoneData?.success ? AVAILABLE : unavailable(reasonFrom(zoneData, 'Zone unavailable')),
				dns,
				ssl,
				rulesets,
				botFightMode,
				turnstile,
				dnsViews,
				dnsFirewall,
				accountAnalytics
			}
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
