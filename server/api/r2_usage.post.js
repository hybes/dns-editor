import { createHash } from 'node:crypto'
import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetch } from '../utils/cfFetch'
import { readId } from '../utils/ids'

// R2 storage and operations per bucket for one account, from Cloudflare's GraphQL Analytics API
// (the r2StorageAdaptiveGroups and r2OperationsAdaptiveGroups datasets described at
// https://developers.cloudflare.com/r2/platform/metrics-analytics/).
// Body: { apiKey, account, from, to }, dates as YYYY-MM-DD in UTC, both days included.
// Answers { success, result: { buckets: [{ name, payloadSize, metadataSize, objectCount, storedOn,
// classA, classB, free, other }], accountWide: { classA, classB, free, other }, from, to, start, end,
// earliest, unclassifiedTypes, truncated } }, or Cloudflare's error envelope. Bucket names in
// another jurisdiction carry its prefix, as R2's metrics report them (eu_my-bucket).

const DAY_MS = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// R2's metrics docs: "Metrics can be queried for a maximum range of 31 days."
const MAX_DAYS = 31
// The most groups one adaptive-groups query returns.
const GROUP_LIMIT = 10_000

// Dataset limits change only with the plan or the token, as in account_analytics.post.js.
const SETTINGS_TTL_MS = 10 * 60_000
const MAX_SETTINGS_ENTRIES = 200

const settingsCache = globalThis.__r2UsageSettingsCache || new Map()
if (!globalThis.__r2UsageSettingsCache) globalThis.__r2UsageSettingsCache = settingsCache

// Operation classes as R2's pricing page lists them (https://developers.cloudflare.com/r2/pricing/,
// “Class A operations”, “Class B operations” and “Free operations”). Any other action type is
// counted as `other` and named in `unclassifiedTypes`, rather than guessed into a class.
const CLASS_A = new Set([
	'ListBuckets',
	'PutBucket',
	'ListObjects',
	'PutObject',
	'CopyObject',
	'CompleteMultipartUpload',
	'CreateMultipartUpload',
	'LifecycleStorageTierTransition',
	'ListMultipartUploads',
	'UploadPart',
	'UploadPartCopy',
	'ListParts',
	'PutBucketEncryption',
	'PutBucketCors',
	'PutBucketLifecycleConfiguration'
])
const CLASS_B = new Set([
	'HeadBucket',
	'HeadObject',
	'GetObject',
	'UsageSummary',
	'GetBucketEncryption',
	'GetBucketLocation',
	'GetBucketCors',
	'GetBucketLifecycleConfiguration'
])
const FREE = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload'])

const badRequest = (message) => createError({ statusCode: 400, message: message })
const errorEnvelope = (message, code) => ({ success: false, errors: [{ message, ...(code && { code }) }] })

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10)
// Cloudflare's Time scalar is RFC 3339; drop milliseconds rather than rely on it accepting them.
const isoTime = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const startOfDay = (ms) => Math.floor(ms / DAY_MS) * DAY_MS

const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

const parseDate = (value, label) => {
	if (typeof value !== 'string' || !DATE_RE.test(value)) {
		throw badRequest(`${label} must be a date in YYYY-MM-DD format`)
	}
	const ms = Date.parse(`${value}T00:00:00Z`)
	if (Number.isNaN(ms) || isoDate(ms) !== value) throw badRequest(`${label} isn’t a real date`)
	return ms
}

const resolveRange = (body, now) => {
	const from = parseDate(body.from, 'From')
	const to = parseDate(body.to, 'To')
	if (from > to) throw badRequest('From must be on or before To')
	if (to > startOfDay(now)) throw badRequest('To can’t be later than today (UTC)')
	if (Math.round((to - from) / DAY_MS) + 1 > MAX_DAYS) {
		throw badRequest(`Cloudflare reports up to ${MAX_DAYS} days of R2 metrics at a time. Choose a shorter range.`)
	}
	return { from, to, start: from, end: Math.min(to + DAY_MS - 1000, now) }
}

// cf has no GraphQL command (the Analytics API isn't part of the OpenAPI schema cf is built
// from), so this route goes to Cloudflare directly, as account_analytics.post.js does.
// GraphQL answers HTTP 200 with an `errors` array, while cfFetch reports timeouts and HTTP
// failures as success:false with Cloudflare's own message.
const graphql = async (apiKey, query, variables) => {
	const response = await cfFetch({ apiKey, method: 'POST', path: '/graphql', body: { query, variables } })
	// GraphQL's own code, such as "authz" for a token without Account Analytics Read, lets the
	// page tell a missing permission from other failures.
	if (response?.errors?.length) {
		const [first] = response.errors
		return {
			error: first?.message || 'Cloudflare rejected the R2 metrics query',
			code: first?.extensions?.code || first?.code
		}
	}
	if (response?.success === false) return { error: 'Cloudflare rejected the R2 metrics query' }
	if (!response?.data) return { error: 'Cloudflare returned no R2 metrics' }
	return { data: response.data }
}

const SETTINGS_QUERY = `query ($tag: String!) {
	viewer {
		accounts(filter: { accountTag: $tag }) {
			settings {
				r2StorageAdaptiveGroups { enabled notOlderThan maxDuration }
				r2OperationsAdaptiveGroups { enabled notOlderThan maxDuration }
			}
		}
	}
}`

// The two datasets' limits, combined: both must be enabled, and the stricter limits apply.
// When Cloudflare won't share them, the data query still runs and its own error decides.
const readSettings = async (apiKey, account) => {
	const key = `${createHash('sha1').update(apiKey).digest('hex')}:${account}`
	const cached = settingsCache.get(key)
	if (cached && cached.expiresAt > Date.now()) return cached.value

	const { data, error } = await graphql(apiKey, SETTINGS_QUERY, { tag: account })
	const settings = data?.viewer?.accounts?.[0]?.settings
	const nodes = [settings?.r2StorageAdaptiveGroups, settings?.r2OperationsAdaptiveGroups]
	if (error || !nodes.every(Boolean)) return { known: false, enabled: true }

	const smallest = (field) =>
		nodes
			.map((node) => Number(node[field]) || 0)
			.reduce((low, value) => (value && (!low || value < low) ? value : low), 0)
	const value = {
		known: true,
		enabled: nodes.every((node) => node.enabled),
		notOlderThan: smallest('notOlderThan'),
		maxDuration: smallest('maxDuration')
	}

	for (const [entryKey, entry] of settingsCache) {
		if (entry.expiresAt <= Date.now() || settingsCache.size >= MAX_SETTINGS_ENTRIES) settingsCache.delete(entryKey)
	}
	settingsCache.set(key, { value, expiresAt: Date.now() + SETTINGS_TTL_MS })
	return value
}

// Storage is grouped by day and storage class, newest day first, so each bucket's latest daily
// peak comes first and a result cut off at the limit only loses the oldest days. A bucket
// holding both Standard and Infrequent Access objects has one group per class, added together.
// Operations are grouped by bucket and action type, largest first.
const DATA_QUERY = `query ($tag: String!, $start: Time!, $end: Time!) {
	viewer {
		accounts(filter: { accountTag: $tag }) {
			storage: r2StorageAdaptiveGroups(
				limit: ${GROUP_LIMIT}
				filter: { datetime_geq: $start, datetime_leq: $end }
				orderBy: [date_DESC]
			) {
				max { payloadSize metadataSize objectCount }
				dimensions { bucketName storageClass date }
			}
			operations: r2OperationsAdaptiveGroups(
				limit: ${GROUP_LIMIT}
				filter: { datetime_geq: $start, datetime_leq: $end }
				orderBy: [sum_requests_DESC]
			) {
				sum { requests }
				dimensions { bucketName actionType }
			}
		}
	}
}`

const shapeBuckets = (node) => {
	const buckets = new Map()
	const bucketFor = (name) => {
		if (!buckets.has(name)) {
			buckets.set(name, {
				name,
				payloadSize: 0,
				metadataSize: 0,
				objectCount: 0,
				storedOn: '',
				classA: 0,
				classB: 0,
				free: 0,
				other: 0
			})
		}
		return buckets.get(name)
	}

	for (const group of node?.storage || []) {
		const name = group?.dimensions?.bucketName
		const date = String(group?.dimensions?.date || '').slice(0, 10)
		if (!name || !date) continue
		const bucket = bucketFor(name)
		if (bucket.storedOn && bucket.storedOn !== date) continue
		bucket.storedOn = date
		bucket.payloadSize += Number(group.max?.payloadSize) || 0
		bucket.metadataSize += Number(group.max?.metadataSize) || 0
		bucket.objectCount += Number(group.max?.objectCount) || 0
	}

	// Operations on the account rather than a bucket, such as ListBuckets, have no bucket name.
	const accountWide = { classA: 0, classB: 0, free: 0, other: 0 }
	const unclassified = new Set()
	for (const group of node?.operations || []) {
		const name = group?.dimensions?.bucketName
		const action = group?.dimensions?.actionType || ''
		const requests = Number(group?.sum?.requests) || 0
		if (!requests) continue
		const counts = name ? bucketFor(name) : accountWide
		if (CLASS_A.has(action)) counts.classA += requests
		else if (CLASS_B.has(action)) counts.classB += requests
		else if (FREE.has(action)) counts.free += requests
		else {
			counts.other += requests
			if (action) unclassified.add(action)
		}
	}

	return {
		buckets: [...buckets.values()].sort((a, b) => a.name.localeCompare(b.name)),
		accountWide,
		unclassifiedTypes: [...unclassified].sort(),
		truncated: (node?.storage?.length || 0) >= GROUP_LIMIT || (node?.operations?.length || 0) >= GROUP_LIMIT
	}
}

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)

		const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
		if (!apiKey) throw badRequest('API key is required')
		const account = readId(body.account, 'Account ID')

		const now = Date.now()
		const range = resolveRange(body, now)

		const settings = await readSettings(apiKey, account)
		if (!settings.enabled) return errorEnvelope('R2 metrics aren’t available to this token for this account')

		// Cloudflare keeps R2 metrics for a limited time. A range reaching further back starts at
		// the earliest day Cloudflare still has, and says so in `earliest`, rather than failing.
		let earliest = ''
		if (settings.known && settings.notOlderThan) {
			const oldest = startOfDay(now - settings.notOlderThan * 1000) + DAY_MS
			if (range.end < oldest) {
				throw badRequest(
					`Cloudflare keeps R2 metrics for ${Math.floor(settings.notOlderThan / 86_400)} days, so there are none for this period. Choose dates from ${longDate.format(oldest)}.`
				)
			}
			if (range.start < oldest) {
				range.start = oldest
				earliest = isoDate(oldest)
			}
		}
		if (settings.known && settings.maxDuration && (range.end - range.start) / 1000 > settings.maxDuration) {
			throw badRequest(
				`Cloudflare reports up to ${Math.floor(settings.maxDuration / 86_400)} days of R2 metrics at a time. Choose a shorter range.`
			)
		}

		const { data, error, code } = await graphql(apiKey, DATA_QUERY, {
			tag: account,
			start: isoTime(range.start),
			end: isoTime(range.end)
		})
		if (error) return errorEnvelope(error, code)

		return {
			success: true,
			errors: [],
			messages: [],
			result: {
				from: isoDate(range.from),
				to: isoDate(range.to),
				start: isoTime(range.start),
				end: isoTime(range.end),
				earliest,
				...shapeBuckets(data.viewer?.accounts?.[0])
			}
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: error?.message || 'Unknown error'
		})
	}
})
