import { cfFetch } from './cfFetch'

const SUPPORTED_STANDARD_RECORD_TYPES = new Set(['A', 'AAAA', 'CNAME', 'MX', 'TXT'])
const MULTI_VALUE_RECORD_TYPES = new Set(['A', 'AAAA', 'MX', 'TXT'])

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

export async function fetchAllDnsRecords({ apiKey, zoneId, cacheTtl = 15000 }) {
	let data = await cfFetch({
		apiKey,
		method: 'GET',
		path: `/zones/${zoneId}/dns_records?per_page=100`,
		cacheTtl
	})

	if (!data.result) data.result = []
	if (!data.success) return data

	const totalPages = data?.result_info?.total_pages || 1
	if (totalPages > 1) {
		const pages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2)
		const results = await Promise.all(
			pages.map((page) =>
				cfFetch({
					apiKey,
					method: 'GET',
					path: `/zones/${zoneId}/dns_records?per_page=100&page=${page}`,
					cacheTtl
				})
			)
		)

		for (const pageData of results) {
			if (pageData.success && pageData.result) data.result = data.result.concat(pageData.result)
		}
	}

	return data
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
