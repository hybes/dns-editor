// Shared lookup tables and formatting for DNS record types, used by the records table,
// the record form and the lookup tools.

const TYPE_COLORS = {
	A: 'primary',
	AAAA: 'secondary',
	CNAME: 'success',
	MX: 'info',
	NS: 'info',
	SRV: 'warning',
	TXT: 'neutral',
	CAA: 'neutral'
}

// Record types this UI can create/edit through the simple form.
export const CREATABLE_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'SRV', 'TXT', 'CAA']

const SHORT_TTL_UNITS = [
	[86_400, 'day'],
	[3_600, 'hr'],
	[60, 'min']
]

const LONG_TTL_UNITS = [
	[86_400, 'day'],
	[3_600, 'hour'],
	[60, 'minute'],
	[1, 'second']
]

// SRV in zone-file order. Cloudflare's own content string leaves the priority out.
const srvValue = (record) =>
	record.data?.target
		? `${record.data.priority ?? record.priority ?? 0} ${record.data.weight ?? 0} ${record.data.port ?? 0} ${record.data.target}`
		: ''

export function useRecordTypes() {
	const getRecordTypeColor = (type) => TYPE_COLORS[type] || 'neutral'

	// The value as shown in lists and copied from them: Cloudflare's content, except SRV,
	// which is shown as "priority weight port target".
	const formatContent = (record) => {
		if (!record) return ''
		if (record.type === 'SRV') return srvValue(record) || record.content || ''
		return record.content || ''
	}

	// The only TTL formatter, so a TTL reads the same everywhere. 1 means Cloudflare picks it.
	// short: '5 min', '1 hr', '2 days' (tables). long: '1 hour 30 minutes' (forms and details).
	// Returns '' for anything that isn't a positive number.
	const formatTtl = (ttl, { style = 'short' } = {}) => {
		const seconds = Number(ttl)
		if (!Number.isFinite(seconds) || seconds <= 0) return ''
		if (seconds === 1) return 'Auto'
		if (style === 'long') {
			let rest = seconds
			const parts = []
			for (const [size, unit] of LONG_TTL_UNITS) {
				const count = Math.floor(rest / size)
				if (!count) continue
				parts.push(`${count} ${unit}${count === 1 ? '' : 's'}`)
				rest -= count * size
			}
			return parts.join(' ')
		}
		for (const [size, unit] of SHORT_TTL_UNITS) {
			if (seconds >= size && seconds % size === 0) {
				const count = seconds / size
				return `${count} ${unit}${unit === 'day' && count !== 1 ? 's' : ''}`
			}
		}
		return `${seconds} sec`
	}

	// The value a public resolver should hand back for this record, in the shape the
	// propagation checker compares against. Empty when the type has no simple form.
	const getExpectedDnsValue = (record) => {
		if (!record) return ''
		switch (record.type) {
			case 'A':
			case 'AAAA':
			case 'CNAME':
			case 'NS':
			case 'TXT':
			case 'PTR':
				return record.content || ''
			case 'MX':
				return record.content ? `${record.priority ?? 0} ${record.content}` : ''
			case 'SRV':
				return srvValue(record)
			case 'CAA':
				return record.data?.tag ? `${record.data.flags ?? 0} ${record.data.tag} ${record.data.value ?? ''}` : ''
			default:
				return ''
		}
	}

	return {
		getRecordTypeColor,
		formatContent,
		formatTtl,
		getExpectedDnsValue
	}
}
