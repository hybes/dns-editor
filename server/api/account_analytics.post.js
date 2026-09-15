import { createHash } from 'node:crypto'
import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'
import { readId } from '../utils/ids'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PRESET_DAYS = { '7d': 7, '30d': 30 }
const TOP_LIMIT = 10
// Ranges this short are more useful hour by hour than as one or two daily bars.
const HOURLY_MAX_DAYS = 2

// Matches the capabilities probe, so the zone lookup is usually answered from its cache.
const ZONE_CACHE_TTL_MS = 60_000
// Dataset limits change only with the plan or the token, so re-asking on every range
// change would just add a round trip.
const SETTINGS_TTL_MS = 10 * 60_000
const MAX_SETTINGS_ENTRIES = 200

const settingsCache = globalThis.__dnsAnalyticsSettingsCache || new Map()
if (!globalThis.__dnsAnalyticsSettingsCache) globalThis.__dnsAnalyticsSettingsCache = settingsCache

const badRequest = (message) => createError({ statusCode: 400, statusMessage: message })
const errorEnvelope = (message) => ({ success: false, errors: [{ message }] })

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10)
// Cloudflare's Time scalar is RFC 3339; drop milliseconds rather than rely on it accepting them.
const isoTime = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const startOfDay = (ms) => Math.floor(ms / DAY_MS) * DAY_MS
const startOfHour = (ms) => Math.floor(ms / HOUR_MS) * HOUR_MS

const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

const describeSpan = (seconds) => {
	const days = seconds / 86_400
	if (days >= 1) return `${Math.floor(days)} ${Math.floor(days) === 1 ? 'day' : 'days'}`
	const hours = Math.max(1, Math.floor(seconds / 3600))
	return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

const parseDate = (value, label) => {
	if (typeof value !== 'string' || !DATE_RE.test(value)) {
		throw badRequest(`${label} must be a date in YYYY-MM-DD format`)
	}
	const ms = Date.parse(`${value}T00:00:00Z`)
	if (Number.isNaN(ms) || isoDate(ms) !== value) throw badRequest(`${label} isn’t a real date`)
	return ms
}

// Works out the window to report on. Dates are UTC days, as Cloudflare stores them.
const resolveRange = (body, now) => {
	const today = startOfDay(now)

	if (body.preset === '24h') {
		const start = startOfHour(now) - 23 * HOUR_MS
		return { preset: '24h', granularity: 'hour', start, end: now, from: isoDate(start), to: isoDate(now) }
	}

	let from
	let to
	let preset = 'custom'
	if (PRESET_DAYS[body.preset]) {
		preset = body.preset
		to = today
		from = today - (PRESET_DAYS[body.preset] - 1) * DAY_MS
	} else {
		from = parseDate(body.from, 'From')
		to = parseDate(body.to, 'To')
		if (from > to) throw badRequest('From must be on or before To')
		if (to > today) throw badRequest('To can’t be later than today (UTC)')
	}

	const days = Math.round((to - from) / DAY_MS) + 1
	return {
		preset,
		granularity: days <= HOURLY_MAX_DAYS ? 'hour' : 'day',
		start: from,
		end: Math.min(to + DAY_MS - 1000, now),
		from: isoDate(from),
		to: isoDate(to)
	}
}

// GraphQL answers HTTP 200 with an `errors` array, while cfFetch reports timeouts and
// HTTP failures as success:false, so both shapes collapse into one error message.
const graphql = async (apiKey, query, variables) => {
	const response = await cfFetch({ apiKey, method: 'POST', path: '/graphql', body: { query, variables } })
	if (response?.errors?.length) {
		return { error: response.errors[0]?.message || 'Cloudflare rejected the analytics query' }
	}
	if (response?.success === false) return { error: 'Cloudflare rejected the analytics query' }
	if (!response?.data) return { error: 'Cloudflare returned no analytics data' }
	return { data: response.data }
}

const scopeNode = (scope) =>
	scope === 'zone' ? 'zones(filter: { zoneTag: $tag })' : 'accounts(filter: { accountTag: $tag })'

// The dataset's limits only sharpen the error message, so when Cloudflare won't share
// them the data query still runs and its own error decides the outcome.
const readSettings = async ({ apiKey, scope, tag, fresh }) => {
	const key = `${createHash('sha1').update(apiKey.trim()).digest('hex')}:${scope}:${tag}`
	const cached = settingsCache.get(key)
	if (!fresh && cached && cached.expiresAt > Date.now()) return cached.value

	const query = `query ($tag: String!) { viewer { ${scopeNode(scope)} { settings { dnsAnalyticsAdaptiveGroups { enabled notOlderThan maxDuration } } } } }`
	const { data, error } = await graphql(apiKey, query, { tag })
	const node = data?.viewer?.[scope === 'zone' ? 'zones' : 'accounts']?.[0]?.settings?.dnsAnalyticsAdaptiveGroups
	if (error || !node) return { known: false, enabled: true }

	const value = {
		known: true,
		enabled: Boolean(node.enabled),
		notOlderThan: node.notOlderThan || 0,
		maxDuration: node.maxDuration || 0
	}

	for (const [entryKey, entry] of settingsCache) {
		if (entry.expiresAt <= Date.now() || settingsCache.size >= MAX_SETTINGS_ENTRIES) settingsCache.delete(entryKey)
	}
	settingsCache.set(key, { value, expiresAt: Date.now() + SETTINGS_TTL_MS })
	return value
}

// Checking the dataset's own limits first gives a message that names the allowed dates,
// instead of Cloudflare's generic complaint about the query.
const assertWithinLimits = (range, settings, subject, now) => {
	if (settings.notOlderThan && range.start < now - settings.notOlderThan * 1000) {
		const earliest = startOfDay(now - settings.notOlderThan * 1000) + DAY_MS
		throw badRequest(
			`Cloudflare keeps ${describeSpan(settings.notOlderThan)} of DNS analytics ${subject}. Choose a From date on or after ${longDate.format(earliest)}.`
		)
	}
	if (settings.maxDuration && (range.end - range.start) / 1000 > settings.maxDuration) {
		throw badRequest(
			`Cloudflare reports up to ${describeSpan(settings.maxDuration)} of DNS analytics at a time ${subject}. Choose a shorter range.`
		)
	}
}

const buildQuery = (scope, granularity, seriesLimit) => {
	const hourly = granularity === 'hour'
	const type = hourly ? 'Time!' : 'Date!'
	const filter = hourly ? '{ datetime_geq: $from, datetime_leq: $to }' : '{ date_geq: $from, date_leq: $to }'
	const bucket = hourly ? 'datetimeHour' : 'date'
	return `query ($tag: String!, $from: ${type}, $to: ${type}) {
	viewer {
		${scopeNode(scope)} {
			total: dnsAnalyticsAdaptiveGroups(filter: ${filter}, limit: 1) { count }
			series: dnsAnalyticsAdaptiveGroups(filter: ${filter}, limit: ${seriesLimit}, orderBy: [${bucket}_ASC]) { count dimensions { ${bucket} } }
			queryTypes: dnsAnalyticsAdaptiveGroups(filter: ${filter}, limit: ${TOP_LIMIT}, orderBy: [count_DESC]) { count dimensions { queryType } }
			responseCodes: dnsAnalyticsAdaptiveGroups(filter: ${filter}, limit: ${TOP_LIMIT}, orderBy: [count_DESC]) { count dimensions { responseCode } }
		}
	}
}`
}

// Cloudflare leaves out buckets with no queries; the chart needs them as zeros.
const bucketsFor = (range) => {
	const keys = []
	if (range.granularity === 'hour') {
		for (let t = startOfHour(range.start); t <= range.end; t += HOUR_MS) keys.push(isoTime(t))
	} else {
		for (let t = Date.parse(`${range.from}T00:00:00Z`); t <= Date.parse(`${range.to}T00:00:00Z`); t += DAY_MS) {
			keys.push(isoDate(t))
		}
	}
	return keys
}

const shapeResult = (node, range, buckets) => {
	const bucketField = range.granularity === 'hour' ? 'datetimeHour' : 'date'
	const counts = new Map()
	for (const group of node?.series || []) {
		const raw = group?.dimensions?.[bucketField]
		if (!raw) continue
		const key = range.granularity === 'hour' ? isoTime(Date.parse(raw)) : String(raw).slice(0, 10)
		counts.set(key, (counts.get(key) || 0) + (group.count || 0))
	}

	const top = (groups, field) =>
		(groups || [])
			.map((group) => ({ name: group?.dimensions?.[field] || 'Unknown', count: group?.count || 0 }))
			.filter((row) => row.count > 0)

	return {
		total: node?.total?.[0]?.count || 0,
		series: buckets.map((time) => ({ time, count: counts.get(time) || 0 })),
		queryTypes: top(node?.queryTypes, 'queryType'),
		responseCodes: top(node?.responseCodes, 'responseCode')
	}
}

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		if (!body.apiKey) throw badRequest('API key is required')
		const zoneId = readId(body.currZone, 'Zone ID')

		const now = Date.now()
		const range = resolveRange(body, now)
		const fresh = body.fresh === true

		const zoneData = await cfFetch({
			apiKey: body.apiKey,
			method: 'GET',
			path: `/zones/${zoneId}`,
			cacheTtl: ZONE_CACHE_TTL_MS,
			fresh
		})
		if (!zoneData?.success) return zoneData

		const zoneName = zoneData.result?.name || ''
		const accountId = zoneData.result?.account?.id || ''
		const accountName = zoneData.result?.account?.name || ''

		// Zone-level data is what this page is about; the account dataset (every zone in
		// the account) is only asked for when the token can't read the zone's own.
		const candidates = [
			{ scope: 'zone', tag: zoneId, subject: `for ${zoneName || 'this zone'}` },
			accountId && {
				scope: 'account',
				tag: accountId,
				subject: 'across this account, the only scope this token can read'
			}
		].filter(Boolean)

		const buckets = bucketsFor(range)
		let zoneFailure = ''
		let firstError = ''

		for (const candidate of candidates) {
			candidate.settings = await readSettings({
				apiKey: String(body.apiKey),
				scope: candidate.scope,
				tag: candidate.tag,
				fresh
			})
			if (!candidate.settings.enabled) {
				const reason = `DNS analytics aren’t available to this token for this ${candidate.scope}`
				firstError ||= reason
				if (candidate.scope === 'zone') zoneFailure = reason
				continue
			}
			if (candidate.settings.known) assertWithinLimits(range, candidate.settings, candidate.subject, now)

			const variables =
				range.granularity === 'hour'
					? { tag: candidate.tag, from: isoTime(range.start), to: isoTime(range.end) }
					: { tag: candidate.tag, from: range.from, to: range.to }
			const { data, error } = await graphql(
				body.apiKey,
				buildQuery(candidate.scope, range.granularity, buckets.length + 1),
				variables
			)

			if (error) {
				firstError ||= error
				if (candidate.scope === 'zone') zoneFailure = error
				continue
			}

			const node = data.viewer?.[candidate.scope === 'zone' ? 'zones' : 'accounts']?.[0]
			return {
				success: true,
				result: {
					scope: candidate.scope,
					zoneName,
					accountName,
					// Why the zone's own data couldn't be shown, when falling back to the account.
					zoneUnavailableReason: candidate.scope === 'account' ? zoneFailure : '',
					preset: range.preset,
					granularity: range.granularity,
					from: range.from,
					to: range.to,
					start: isoTime(range.start),
					end: isoTime(range.end),
					limits: candidate.settings.known
						? { notOlderThan: candidate.settings.notOlderThan, maxDuration: candidate.settings.maxDuration }
						: null,
					...shapeResult(node, range, buckets),
					raw: data
				}
			}
		}

		return errorEnvelope(firstError || 'Cloudflare returned no DNS analytics')
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
