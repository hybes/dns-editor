// Well-known SRV services with the port each one conventionally uses.
const SERVICES = [
	{ label: 'SIP over TCP', value: '_sip._tcp', port: 5060 },
	{ label: 'SIP over UDP', value: '_sip._udp', port: 5060 },
	{ label: 'SIP over TLS', value: '_sips._tcp', port: 5061 },
	{ label: 'XMPP client', value: '_xmpp-client._tcp', port: 5222 },
	{ label: 'XMPP server', value: '_xmpp-server._tcp', port: 5269 },
	{ label: 'LDAP', value: '_ldap._tcp', port: 389 },
	{ label: 'IMAP', value: '_imap._tcp', port: 143 },
	{ label: 'IMAPS', value: '_imaps._tcp', port: 993 },
	{ label: 'SMTP', value: '_smtp._tcp', port: 25 },
	{ label: 'Mail submission', value: '_submission._tcp', port: 587 },
	{ label: 'Minecraft', value: '_minecraft._tcp', port: 25565 },
	{ label: 'TeamSpeak 3', value: '_ts3._udp', port: 9987 }
]

const PROTOCOLS = ['_tcp', '_udp', '_tls']

const withUnderscore = (value) => {
	const text = String(value ?? '').trim()
	return !text || text.startsWith('_') ? text : `_${text}`
}

// SRV names are `_service._proto.host`. Cloudflare only accepts that full name, so the form
// builds it once here and shows the same string it sends.
export function useSrvRecord() {
	// The host must already include the zone (or be empty to let Cloudflare add it).
	const buildName = ({ service, protocol }, host) =>
		[withUnderscore(service), withUnderscore(protocol), host].filter(Boolean).join('.')

	const parseName = (fullName) => {
		const name = String(fullName || '')
		const labels = name.split('.')
		if (labels.length >= 2 && labels[0].startsWith('_') && labels[1].startsWith('_')) {
			return { service: labels[0], protocol: labels[1], host: labels.slice(2).join('.') }
		}
		return { service: '', protocol: '', host: name }
	}

	const findService = ({ service, protocol }) =>
		SERVICES.find((item) => item.value === `${withUnderscore(service)}.${withUnderscore(protocol)}`) || null

	return { services: SERVICES, protocols: PROTOCOLS, withUnderscore, buildName, parseName, findService }
}
