import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'
import { cfCommand } from '../utils/cfCommand'
import { readId } from '../utils/ids'
import { MISSING_PERMISSION_CODES, R2_NOT_ENABLED_CODE } from '#shared/utils/cloudflare'
import { allows } from '#shared/utils/access'

// For a zone shared with this account, the area each feature belongs to. Features not listed
// act on the owner's whole account, so they stay the owner's.
const SHARED_AREAS = {
	zones: null,
	zone: null,
	dns: 'records',
	ssl: 'settings',
	zoneSettings: 'settings',
	botFightMode: 'settings',
	rulesets: 'rules',
	dnssec: 'dns',
	dnsSettings: 'dns',
	zoneTransfers: 'dns',
	r2: 'files',
	accountAnalytics: 'analytics'
}

// What a shared account can use: what the owner's connection can, within the levels given.
function withinShare(result, access) {
	return Object.fromEntries(
		Object.entries(result).map(([key, value]) => {
			if (!(key in SHARED_AREAS)) return [key, unavailable(`Only ${access.owner} can use this.`)]
			const area = SHARED_AREAS[key]
			if (area && !allows(access.levels[area], 'view'))
				return [key, unavailable(`${access.owner} hasn’t shared this with you.`)]
			return [key, value]
		})
	)
}

const CACHE_TTL = 60000
const AVAILABLE = { available: true, reason: '' }
const ANALYTICS_QUERY =
	'query ($accountTag: String!, $date_geq: Date!, $date_leq: Date!) { viewer { accounts(filter: { accountTag: $accountTag }) { dnsAnalyticsAdaptiveGroups(filter: { date_geq: $date_geq, date_leq: $date_leq } limit: 1) { count } } } }'

const ZONE_ANALYTICS_QUERY =
	'query ($zoneTag: String!) { viewer { zones(filter: { zoneTag: $zoneTag }) { settings { dnsAnalyticsAdaptiveGroups { enabled } } } } }'

// `fixable`: Cloudflare refused for want of a token permission, or because R2 isn't turned on, so
// the sidebar keeps the page with a lock and the page says what to change. Anything else, such as
// a feature the plan doesn't include, hides it.
const unavailable = (reason, fixable = false) => ({ available: false, reason, ...(fixable && { fixable: true }) })
const reasonFrom = (data, fallback) => data?.errors?.[0]?.message || fallback
const fixableFrom = (...answers) =>
	answers.some((data) =>
		(data?.errors || []).some(
			(error) =>
				MISSING_PERMISSION_CODES.has(error?.code) ||
				MISSING_PERMISSION_CODES.has(error?.extensions?.code) ||
				error?.code === R2_NOT_ENABLED_CODE
		)
	)
const isoDate = (date) => date.toISOString().slice(0, 10)

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) {
			throw createError({ statusCode: 400, message: 'API key is required' })
		}

		// Each probe is the cf command the feature's page runs, asked for as little as possible.
		const run = (command, input) => cfCommand({ apiKey: body.apiKey, command, cacheTtl: CACHE_TTL, ...input })

		const probe = async (featureName, command, input) => {
			const data = await run(command, input)
			return data?.success
				? AVAILABLE
				: unavailable(reasonFrom(data, `${featureName} unavailable`), fixableFrom(data))
		}

		// Listing rulesets can succeed while reading one is forbidden, so check both.
		// Only the zone's own entry point rulesets count, the ones the Rules page edits: Cloudflare's
		// managed and DDoS rulesets in the same list need other permissions. Reading any one of them
		// is enough, since the page asks for each phase separately.
		const probeRulesets = async (zoneId) => {
			const list = await run('rulesets account-rulesets list', { zone: zoneId, flags: { 'per-page': 50 } })
			if (!list?.success) return unavailable(reasonFrom(list, 'Rulesets unavailable'), fixableFrom(list))
			const own = (list.result || []).filter((ruleset) => ruleset?.id && ruleset.kind === 'zone').slice(0, 3)
			if (!own.length) return AVAILABLE
			const details = await Promise.all(
				own.map((ruleset) =>
					run('rulesets account-rulesets get', { zone: zoneId, args: { 'ruleset-id': ruleset.id } })
				)
			)
			if (details.some((detail) => detail?.success)) return AVAILABLE
			return unavailable(reasonFrom(details[0], 'Rulesets unavailable'), fixableFrom(...details))
		}

		// cf has no GraphQL command, so analytics are probed against the API directly.
		// GraphQL reports permission problems in `errors` alongside HTTP 200.
		const graphql = (query, variables) =>
			cfFetch({ apiKey: body.apiKey, method: 'POST', path: '/graphql', body: { query, variables } })

		// The Analytics page reads the zone's own DNS analytics first and falls back to the
		// account's, so the feature is available when either one can be read.
		const probeAnalytics = async (zoneId, accountId) => {
			const zone = await graphql(ZONE_ANALYTICS_QUERY, { zoneTag: zoneId })
			const zoneSettings = zone?.data?.viewer?.zones?.[0]?.settings?.dnsAnalyticsAdaptiveGroups
			if (zone && !zone.errors && zoneSettings?.enabled) return AVAILABLE
			if (!accountId) return unavailable(reasonFrom(zone, 'DNS analytics unavailable'), fixableFrom(zone))

			const today = new Date()
			const yesterday = new Date(today.getTime() - 86_400_000)
			const account = await graphql(ANALYTICS_QUERY, {
				accountTag: accountId,
				date_geq: isoDate(yesterday),
				date_leq: isoDate(today)
			})
			return account && !account.errors
				? AVAILABLE
				: unavailable(
						reasonFrom(account, reasonFrom(zone, 'DNS analytics unavailable')),
						fixableFrom(account, zone)
					)
		}

		const zoneId = readId(body.currZone, 'Zone ID')

		const zoneData = await run('zones get', { zone: zoneId })
		const accountId = zoneData?.success ? zoneData.result?.account?.id || '' : ''
		// When the zone can't be read, its error explains why account features can't be checked.
		const accountReason = zoneData?.success
			? 'Cloudflare didn’t return an account for this zone'
			: reasonFrom(zoneData, 'Couldn’t look up this zone’s account')
		const forAccount = (task) => (accountId ? task() : Promise.resolve(unavailable(accountReason)))
		const plan = zoneData?.success ? zoneData.result?.plan : null
		const enterprise = /enterprise/i.test(`${plan?.legacy_id || ''} ${plan?.name || ''}`)
		// DNS Firewall (a paid add-on) and DNS Views (part of Internal DNS) are Enterprise-only, so
		// outside an Enterprise zone's account no permission unlocks them: hide them, don't lock them.
		// https://developers.cloudflare.com/dns/dns-firewall/ and /dns/internal-dns/
		const enterpriseOnly = (check) =>
			check.then((result) => (result.fixable && !enterprise ? unavailable(result.reason) : result))

		const [
			zones,
			dns,
			ssl,
			rulesets,
			botFightMode,
			dnssec,
			dnsSettings,
			turnstile,
			dnsViews,
			dnsFirewall,
			zoneTransfers,
			r2,
			accountAnalytics
		] = await Promise.all([
			probe('Zones', 'zones list'),
			probe('DNS', 'dns records list', { zone: zoneId, flags: { 'per-page': 1 } }),
			probe('SSL', 'zones settings get', { zone: zoneId, args: { 'setting-id': 'ssl' } }),
			probeRulesets(zoneId),
			probe('Bot Management', 'bot-management get', { zone: zoneId }),
			probe('DNSSEC', 'dns dnssec get', { zone: zoneId }),
			probe('DNS settings', 'dns settings account get', { zone: zoneId, target: 'zone' }),
			forAccount(() => probe('Turnstile', 'turnstile widgets list', { account: accountId })),
			enterpriseOnly(
				forAccount(() => probe('DNS Views', 'dns settings account views list', { account: accountId }))
			),
			enterpriseOnly(forAccount(() => probe('DNS Firewall', 'dns-firewall list', { account: accountId }))),
			// Peers are account-wide and exist only where zone transfers are enabled, so they answer
			// for the whole feature, including a zone that has no transfer set up yet.
			forAccount(() => probe('Zone transfers', 'dns zone-transfers peers list', { account: accountId })),
			forAccount(() => probe('R2', 'r2 buckets list', { account: accountId, flags: { 'per-page': 1 } })),
			probeAnalytics(zoneId, accountId)
		])

		const result = {
			zones,
			zone: zoneData?.success ? AVAILABLE : unavailable(reasonFrom(zoneData, 'Zone unavailable')),
			dns,
			ssl,
			// Every zone setting is read with the same permission as SSL/TLS.
			zoneSettings: ssl,
			rulesets,
			botFightMode,
			dnssec,
			dnsSettings,
			turnstile,
			dnsViews,
			dnsFirewall,
			zoneTransfers,
			r2,
			accountAnalytics
		}
		const access = event.context.access
		return {
			success: true,
			result: access?.shared ? withinShare(result, access) : result,
			access: access?.shared
				? { shared: true, owner: access.owner, levels: access.levels, showPrices: access.showPrices }
				: { shared: false }
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: error?.message || 'Unknown error'
		})
	}
})
