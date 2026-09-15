import { cfFetch } from './cfFetch'

const SUPPORTED_STANDARD_RECORD_TYPES = new Set(['A', 'AAAA', 'CNAME', 'MX', 'TXT'])
const MULTI_VALUE_RECORD_TYPES = new Set(['A', 'AAAA', 'MX', 'TXT'])
const RECORDS_PER_PAGE = 500
const PAGE_CONCURRENCY = 4

const normalizeWhitespace = (value) =>
	typeof value === 'string'
		? value
				.replace(/\r/g, '')
				.split('\n')
				.map((line) => line.trim())
				.join('\n')
				.trim()
		: ''

const stripTrailingDot = (value) => normalizeWhitespace(value).replace(/\.$/, '')

const stripWrappingQuotes = (value) => {
	const trimmed = normalizeWhitespace(value)
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1).trim()
	}
	return trimmed
}

export const normalizeRecordName = (name, zoneName) => {
	const normalizedZone = stripTrailingDot(zoneName).toLowerCase()
	const rawName = stripTrailingDot(name)
	if (!rawName || rawName === '@') return normalizedZone
	if (!normalizedZone) return rawName.toLowerCase()
	const loweredName = rawName.toLowerCase()
	if (loweredName === normalizedZone || loweredName.endsWith(`.${normalizedZone}`)) return loweredName
	return `${loweredName}.${normalizedZone}`
}

export const getDisplayName = (name, zoneName) => {
	const normalizedZone = stripTrailingDot(zoneName).toLowerCase()
	const normalizedName = stripTrailingDot(name).toLowerCase()
	if (!normalizedName || normalizedName === normalizedZone) return '@'
	if (!normalizedZone || !normalizedName.endsWith(`.${normalizedZone}`)) return normalizedName
	return normalizedName.slice(0, -normalizedZone.length - 1)
}

const normalizeRecordContent = (type, content) => {
	const normalizedType = String(type || '').toUpperCase()
	if (normalizedType === 'TXT') return stripWrappingQuotes(content)
	if (normalizedType === 'CNAME' || normalizedType === 'MX') return stripTrailingDot(content).toLowerCase()
	return normalizeWhitespace(content)
}

const toPriority = (value) => {
	if (value === null || value === undefined || value === '') return null
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : null
}

const toTtl = (value) => {
	const parsed = Number(value)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

const isProxiable = (type) => type === 'A' || type === 'AAAA' || type === 'CNAME'

const normalizeProposedRecord = (record, zoneName) => {
	const type = String(record?.type || '')
		.toUpperCase()
		.trim()
	if (!SUPPORTED_STANDARD_RECORD_TYPES.has(type)) return null

	const content = normalizeRecordContent(type, record.content)
	const name = normalizeRecordName(record.name, zoneName)
	if (!name || !content) return null

	return {
		type,
		name,
		displayName: getDisplayName(name, zoneName),
		content,
		priority: type === 'MX' ? (toPriority(record.priority) ?? 0) : null,
		ttl: toTtl(record.ttl),
		proxied: isProxiable(type) ? Boolean(record.proxied) : false
	}
}

const normalizeExistingRecord = (record, zoneName) => ({
	id: record.id,
	type: String(record.type || '')
		.toUpperCase()
		.trim(),
	name: normalizeRecordName(record.name, zoneName),
	content: normalizeRecordContent(record.type, record.content),
	priority: record.type === 'MX' ? (toPriority(record.priority) ?? 0) : null,
	proxied: Boolean(record.proxied)
})

const getExactMatch = (record, existingRecords) =>
	existingRecords.find(
		(existing) =>
			existing.type === record.type &&
			existing.name === record.name &&
			existing.content === record.content &&
			existing.priority === record.priority
	)

const getSameNameRecords = (record, existingRecords) =>
	existingRecords.filter((existing) => existing.name === record.name)

const canUpdateInPlace = (record) => record.type === 'CNAME'

export function buildDnsPlan({ proposedRecords = [], existingRecords = [], zoneName, warnings = [], summary = '' }) {
	const normalizedExisting = existingRecords.map((record) => normalizeExistingRecord(record, zoneName))
	const seen = new Set()
	const planWarnings = [...warnings]
	const records = []

	for (const proposedRecord of proposedRecords) {
		const normalized = normalizeProposedRecord(proposedRecord, zoneName)
		if (!normalized) {
			planWarnings.push(`Skipped an unsupported or incomplete record: ${JSON.stringify(proposedRecord)}`)
			continue
		}

		const dedupeKey = `${normalized.type}:${normalized.name}:${normalized.content}:${normalized.priority ?? ''}`
		if (seen.has(dedupeKey)) continue
		seen.add(dedupeKey)

		const exactMatch = getExactMatch(normalized, normalizedExisting)
		if (exactMatch) {
			records.push({
				...normalized,
				action: 'exists',
				reason: 'Already present in this zone',
				existingRecordId: exactMatch.id,
				existingContent: exactMatch.content,
				existingProxied: exactMatch.proxied
			})
			continue
		}

		const sameNameRecords = getSameNameRecords(normalized, normalizedExisting)
		const existingCname = sameNameRecords.find((record) => record.type === 'CNAME')
		if (normalized.type === 'CNAME' && sameNameRecords.some((record) => record.type !== 'CNAME')) {
			records.push({
				...normalized,
				action: 'conflict',
				reason: 'A CNAME cannot be added because another record already uses this name'
			})
			continue
		}

		if (normalized.type !== 'CNAME' && existingCname) {
			records.push({
				...normalized,
				action: 'conflict',
				reason: 'This name already has a CNAME record, so Cloudflare will reject another type',
				existingRecordId: existingCname.id,
				existingContent: existingCname.content
			})
			continue
		}

		const sameTypeRecords = sameNameRecords.filter((record) => record.type === normalized.type)
		if (sameTypeRecords.length === 1 && canUpdateInPlace(normalized)) {
			records.push({
				...normalized,
				action: 'update',
				reason: 'Will update the existing CNAME at this name',
				existingRecordId: sameTypeRecords[0].id,
				existingContent: sameTypeRecords[0].content,
				existingProxied: sameTypeRecords[0].proxied
			})
			continue
		}

		records.push({
			...normalized,
			action: 'create',
			reason:
				sameTypeRecords.length > 0 && MULTI_VALUE_RECORD_TYPES.has(normalized.type)
					? 'Will add another record at this name'
					: 'Missing from the current zone'
		})
	}

	const actionCounts = records.reduce(
		(acc, record) => {
			acc[record.action] = (acc[record.action] || 0) + 1
			return acc
		},
		{ create: 0, update: 0, exists: 0, conflict: 0 }
	)

	const safeSummary =
		summary && summary.trim()
			? summary.trim()
			: `Prepared ${actionCounts.create + actionCounts.update} change${
					actionCounts.create + actionCounts.update === 1 ? '' : 's'
				} for ${stripTrailingDot(zoneName)}.`

	return {
		summary: safeSummary,
		warnings: Array.from(new Set(planWarnings.filter(Boolean))),
		records,
		counts: actionCounts
	}
}

// Runs `task` for each item with at most `limit` in flight, keeping results in input order.
const mapWithConcurrency = async (items, limit, task) => {
	const results = new Array(items.length)
	let next = 0
	const worker = async () => {
		while (next < items.length) {
			const index = next++
			results[index] = await task(items[index])
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
	return results
}

const failureEnvelope = (error) => ({
	success: false,
	errors: [{ message: error?.message || 'Cloudflare didn’t respond' }]
})

// Loads every page of a zone's records. If page 1 fails, the whole request fails with
// Cloudflare's error. A later page that still fails after one retry, or a total that doesn't
// add up, returns what did load flagged partial:true with a message, so an incomplete list
// never passes for a complete one. Pages load a few at a time to stay clear of rate limits.
export async function fetchAllDnsRecords({ apiKey, zoneId, cacheTtl = 15000, fresh = false }) {
	const getPage = (page) =>
		cfFetch({
			apiKey,
			method: 'GET',
			path: `/zones/${zoneId}/dns_records?per_page=${RECORDS_PER_PAGE}&page=${page}`,
			cacheTtl,
			fresh
		}).catch(failureEnvelope)

	const first = await getPage(1)
	if (!first?.success) {
		return { ...first, success: false, result: [] }
	}

	const totalPages = Number(first.result_info?.total_pages) || 1
	const totalCount = Number(first.result_info?.total_count) || 0
	const laterPages = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 2)

	const pages = await mapWithConcurrency(laterPages, PAGE_CONCURRENCY, async (page) => {
		const data = await getPage(page)
		return data?.success ? data : getPage(page)
	})

	// Keyed by ID so a record that moved between pages while loading isn't listed twice.
	const byId = new Map()
	for (const record of first.result || []) byId.set(record.id, record)
	const failures = []
	for (const data of pages) {
		if (data?.success) {
			for (const record of data.result || []) byId.set(record.id, record)
		} else {
			failures.push(data?.errors?.[0]?.message || '')
		}
	}

	const result = [...byId.values()]
	const expected = Math.max(totalCount, result.length)
	const resultInfo = { count: result.length, total_count: expected }

	if (!failures.length && result.length >= totalCount) {
		return { success: true, errors: [], messages: first.messages || [], result, result_info: resultInfo }
	}

	const pagesLabel = failures.length === 1 ? 'one page' : `${failures.length} pages`
	const detail = failures[0] ? `: ${failures[0].replace(/\.$/, '')}` : ''
	const reason = failures.length
		? `Cloudflare didn’t return ${pagesLabel}${detail}.`
		: 'Records changed while the list was loading.'

	return {
		success: true,
		partial: true,
		message: `Only ${result.length} of ${expected} records loaded. ${reason}`,
		errors: [],
		messages: first.messages || [],
		result,
		result_info: resultInfo
	}
}

export function buildCloudflareDnsPayload(change) {
	const normalized = normalizeProposedRecord(change, change.zoneName || '')
	if (!normalized) return null

	const payload = {
		type: normalized.type,
		name: normalized.name,
		content: normalized.content,
		ttl: normalized.ttl,
		comment: ''
	}

	if (normalized.priority !== null) payload.priority = normalized.priority
	if (isProxiable(normalized.type)) payload.proxied = normalized.proxied

	return payload
}

export const dnsPlanSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['summary', 'warnings', 'records'],
	properties: {
		summary: { type: 'string' },
		warnings: {
			type: 'array',
			items: { type: 'string' }
		},
		records: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['type', 'name', 'content', 'priority', 'ttl', 'proxied'],
				properties: {
					type: { type: 'string' },
					name: { type: 'string' },
					content: { type: 'string' },
					priority: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
					ttl: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
					proxied: { anyOf: [{ type: 'boolean' }, { type: 'null' }] }
				}
			}
		}
	}
}
