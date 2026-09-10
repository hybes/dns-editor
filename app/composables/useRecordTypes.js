// Shared lookup tables + formatting for DNS record types, previously duplicated
// across the records list and the create/edit pages.

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

const TYPE_ICONS = {
	A: 'heroicons:map-pin',
	AAAA: 'heroicons:map-pin',
	CNAME: 'heroicons:link',
	MX: 'heroicons:envelope',
	NS: 'heroicons:globe-alt',
	SRV: 'heroicons:server-stack',
	TXT: 'heroicons:document-text',
	CAA: 'heroicons:shield-check'
}

const TYPE_DESCRIPTIONS = {
	A: 'A Record: Maps a domain to an IPv4 address',
	AAAA: 'AAAA Record: Maps a domain to an IPv6 address',
	CNAME: 'CNAME Record: Creates an alias pointing to another domain',
	MX: 'MX Record: Directs email to a mail server',
	NS: 'NS Record: Delegates a subdomain to other name servers',
	SRV: 'SRV Record: Maps services to specific servers and ports',
	TXT: 'TXT Record: Stores text information for verification or other purposes',
	CAA: 'CAA Record: Controls which certificate authorities may issue certificates'
}

const TYPE_HELP = {
	A: 'Enter an IPv4 address like 192.168.1.1 in the Content field.',
	AAAA: 'Enter an IPv6 address like 2606:4700::1 in the Content field.',
	CNAME: 'Enter a domain name that this domain should point to.',
	MX: 'Enter a mail server hostname and set the Priority (lower numbers have higher priority).',
	NS: 'Enter the hostname of the name server to delegate to.',
	SRV: 'Configure service location by specifying service, protocol, target server and port.',
	TXT: 'Enter verification codes or other text-based information.',
	CAA: 'Enter the CA domain (e.g. letsencrypt.org). Use the flags/tag for advanced control.'
}

// Record types this UI can create/edit through the simple form.
export const CREATABLE_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'SRV', 'TXT', 'CAA']

export function useRecordTypes() {
	const getRecordTypeColor = (type) => TYPE_COLORS[type] || 'neutral'
	const getRecordTypeIcon = (type) => TYPE_ICONS[type] || 'heroicons:circle-stack'
	const getDnsTypeDescription = (type) => TYPE_DESCRIPTIONS[type] || `${type} Record`
	const getDnsTypeHelp = (type) => TYPE_HELP[type] || 'Configure your DNS record settings below.'

	// Human-friendly content string, handling SRV's structured data.
	const formatContent = (record) => {
		if (record.type === 'SRV' && record.data) {
			if (record.name && record.name.includes('_minecraft._tcp')) {
				const domainPart = record.name.split('_minecraft._tcp.')[1]
				if (domainPart) return `${domainPart} → ${record.data.target}:${record.data.port}`
			}
			if (record.data.target && record.data.port) {
				return `➡️ ${record.data.target}:${record.data.port}${
					record.data.weight ? ` (Weight: ${record.data.weight})` : ''
				}`
			}
		}
		return record.content || ''
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
				return record.data?.target
					? `${record.data.priority ?? 0} ${record.data.weight ?? 0} ${record.data.port ?? 0} ${record.data.target}`
					: ''
			case 'CAA':
				return record.data?.tag ? `${record.data.flags ?? 0} ${record.data.tag} ${record.data.value ?? ''}` : ''
			default:
				return ''
		}
	}

	return {
		getRecordTypeColor,
		getRecordTypeIcon,
		getDnsTypeDescription,
		getDnsTypeHelp,
		formatContent,
		getExpectedDnsValue,
		CREATABLE_RECORD_TYPES
	}
}
