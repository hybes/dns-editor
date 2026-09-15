import { createError } from 'h3'

const PROXIABLE_TYPES = new Set(['A', 'AAAA', 'CNAME'])

const invalid = (statusMessage) => createError({ statusCode: 400, statusMessage })

const isBlank = (value) => value === undefined || value === null || String(value).trim() === ''

// Accepts numbers and numeric strings. A blank or malformed value is rejected instead of
// being saved as 0.
const readInteger = (value, label, min, max) => {
	const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
	if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) {
		throw invalid(`${label} must be a whole number from ${min} to ${max}.`)
	}
	return number
}

const readText = (value, message) => {
	if (isBlank(value)) throw invalid(message)
	return String(value)
}

// Builds the Cloudflare body for both create_record and update_record, so the two routes
// validate and shape records identically. SRV names arrive already built
// (_service._proto.host) because the form previews exactly the name it sends.
export const buildRecordBody = (dns) => {
	if (!dns || typeof dns !== 'object') throw invalid('The request is missing the record to save.')

	const type = String(dns.type || '')
		.trim()
		.toUpperCase()
	if (!type) throw invalid('Choose a record type.')

	const body = { type, name: readText(dns.name, 'Enter a name for the record.').trim(), ttl: 1 }

	if (!isBlank(dns.ttl)) {
		body.ttl = readInteger(dns.ttl, 'TTL', 1, 86400)
		if (body.ttl !== 1 && body.ttl < 30) throw invalid('TTL must be Auto or from 30 to 86400 seconds.')
	}

	if (dns.comment !== undefined) body.comment = dns.comment === null ? '' : String(dns.comment)

	// Sent back untouched so a full overwrite doesn't clear what the form doesn't edit.
	if (Array.isArray(dns.tags) && dns.tags.length) body.tags = dns.tags
	if (dns.settings && typeof dns.settings === 'object' && Object.keys(dns.settings).length) {
		body.settings = dns.settings
	}

	const data = dns.data && typeof dns.data === 'object' ? dns.data : {}

	switch (type) {
		case 'SRV': {
			const labels = body.name.split('.')
			if (labels.length < 2 || !labels[0].startsWith('_') || !labels[1].startsWith('_')) {
				throw invalid('SRV names must start with the service and protocol, such as _sip._tcp.')
			}
			body.data = {
				priority: readInteger(data.priority, 'SRV priority', 0, 65535),
				weight: readInteger(data.weight, 'SRV weight', 0, 65535),
				port: readInteger(data.port, 'SRV port', 0, 65535),
				target: readText(data.target, 'Enter the SRV target hostname.').trim()
			}
			break
		}
		case 'CAA': {
			const tag = String(data.tag || '').trim()
			if (!/^[a-z0-9]+$/i.test(tag)) throw invalid('Choose a CAA tag, such as issue, issuewild or iodef.')
			body.data = {
				flags: readInteger(data.flags ?? 0, 'CAA flags', 0, 255),
				tag,
				value: readText(data.value, 'Enter the CAA value.').trim()
			}
			break
		}
		case 'MX':
			body.content = readText(dns.content, 'Enter the mail server hostname.').trim()
			body.priority = readInteger(dns.priority, 'MX priority', 0, 65535)
			break
		default:
			if (isBlank(dns.content) && Object.keys(data).length) {
				// Types without a form here (HTTPS, TLSA and so on) keep their structured data.
				body.data = data
			} else {
				const content = readText(dns.content, 'Enter the record content.')
				// Whitespace can be meaningful in TXT values, so only trim other types.
				body.content = type === 'TXT' ? content : content.trim()
			}
			if (PROXIABLE_TYPES.has(type)) body.proxied = dns.proxied === true
	}

	return body
}
