// All SRV-record helper logic in one place. Previously this (commonServices,
// loadSrvPreset, updateSrvFromSimple, getSrvFullName, detectServiceType, display
// formatting) was copy-pasted across the create and edit pages.

export const COMMON_SERVICES = [
	{ label: 'SIP (Voice/Video)', value: '_sip._tcp' },
	{ label: 'XMPP (Chat)', value: '_xmpp-server._tcp' },
	{ label: 'LDAP (Directory)', value: '_ldap._tcp' },
	{ label: 'IMAP (Email)', value: '_imap._tcp' },
	{ label: 'SMTP (Email)', value: '_smtp._tcp' },
	{ label: 'Minecraft', value: '_minecraft._tcp' },
	{ label: 'TeamSpeak', value: '_ts3._udp' },
	{ label: 'Custom', value: 'custom' }
]

export const SRV_QUICK_PRESETS = [
	{ label: 'SIP', serviceProto: '_sip._tcp', port: 5060, color: 'primary' },
	{ label: 'XMPP', serviceProto: '_xmpp-server._tcp', port: 5269, color: 'primary' },
	{ label: 'LDAP', serviceProto: '_ldap._tcp', port: 389, color: 'primary' },
	{ label: 'IMAP', serviceProto: '_imap._tcp', port: 143, color: 'primary' },
	{ label: 'SMTP', serviceProto: '_smtp._tcp', port: 25, color: 'primary' },
	{ label: 'Minecraft', serviceProto: '_minecraft._tcp', port: 25565, color: 'success' }
]

const withUnderscore = (value) => {
	const str = String(value || '')
	return str.startsWith('_') ? str : `_${str}`
}

export function useSrvRecord() {
	// Structured SRV fields. service is stored with a leading underscore, proto without
	// one, matching how Cloudflare returns them; getFullName() normalises on the way out.
	const srvData = ref({ service: '', proto: '', name: '', target: '', port: '', priority: 1, weight: 10 })
	const advancedSrvMode = ref(false)
	const srvSimpleService = ref('')

	const reset = () => {
		srvData.value = { service: '', proto: '', name: '', target: '', port: '', priority: 1, weight: 10 }
		advancedSrvMode.value = false
		srvSimpleService.value = ''
	}

	const loadQuickPreset = (serviceProto, port) => {
		const [service, proto] = serviceProto.split('.')
		srvData.value.service = service
		srvData.value.proto = proto.replace(/^_/, '')
		srvData.value.port = port
		srvData.value.priority = srvData.value.priority || 1
		srvData.value.weight = srvData.value.weight || 10
		srvSimpleService.value = serviceProto
	}

	const updateFromSimple = () => {
		if (srvSimpleService.value === 'custom') {
			advancedSrvMode.value = true
			return
		}
		const [service, proto] = srvSimpleService.value.split('.')
		srvData.value.service = service
		srvData.value.proto = proto.replace(/^_/, '')
	}

	// Build the technical _service._proto.name string Cloudflare expects.
	const getFullName = () => {
		const { service, proto, name } = srvData.value
		if (!service || !proto || !name) return ''
		let host = name
		if (service === '_minecraft' && proto === 'tcp' && host.startsWith('mc.')) {
			host = host.substring(3)
		}
		return `${withUnderscore(service)}.${withUnderscore(proto)}.${host}`
	}

	// Friendly label for headings, e.g. "sip.tcp.example.com" or the Minecraft arrow form.
	const getDisplayName = () => {
		const { service, proto, name, target, port } = srvData.value
		if (!service || !proto || !name) return ''
		if (service === '_minecraft' && proto === 'tcp') {
			return `${name} → ${target}:${port || '25565'}`
		}
		return `${String(service).replace(/_/g, '')}.${proto}.${name}`
	}

	// Populate state from an existing Cloudflare record (edit flow).
	// IMPORTANT: parse service/proto/host from the top-level record.name (the full
	// `_service._proto.host` FQDN). Cloudflare's structured `data.name` is NOT a bare
	// host, so using it directly would make getFullName() double-prefix on save.
	const loadFromRecord = (record) => {
		const data = record?.data || {}
		const fullName = record?.name || ''
		if (fullName.includes('._')) {
			const parts = fullName.split('.')
			const serviceParts = parts.filter((p) => p.startsWith('_'))
			srvData.value = {
				service: serviceParts[0] || withUnderscore(data.service || ''),
				proto: (serviceParts[1] || `_${data.proto || ''}`).replace(/^_/, ''),
				name: parts.slice(serviceParts.length).join('.'),
				target: data.target || '',
				port: data.port ?? '',
				priority: data.priority ?? 1,
				weight: data.weight ?? 10
			}
		} else if (data.service && data.proto) {
			srvData.value = {
				service: withUnderscore(data.service),
				proto: String(data.proto).replace(/^_/, ''),
				name: data.name || '',
				target: data.target || '',
				port: data.port ?? '',
				priority: data.priority ?? 1,
				weight: data.weight ?? 10
			}
		}

		const serviceProto = `${srvData.value.service}._${srvData.value.proto}`
		const found = COMMON_SERVICES.find((s) => s.value === serviceProto)
		if (found) {
			srvSimpleService.value = found.value
		} else {
			srvSimpleService.value = 'custom'
			advancedSrvMode.value = true
		}
	}

	const isValid = () => {
		const port = Number(srvData.value.port)
		const hasValidPort =
			srvData.value.port !== '' &&
			srvData.value.port !== null &&
			Number.isInteger(port) &&
			port >= 0 &&
			port <= 65535
		return Boolean(
			srvData.value.service && srvData.value.proto && srvData.value.name && srvData.value.target && hasValidPort
		)
	}

	return {
		srvData,
		advancedSrvMode,
		srvSimpleService,
		commonServices: COMMON_SERVICES,
		quickPresets: SRV_QUICK_PRESETS,
		reset,
		loadQuickPreset,
		updateFromSimple,
		getFullName,
		getDisplayName,
		loadFromRecord,
		isValid
	}
}
