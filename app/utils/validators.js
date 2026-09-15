// Format checks shared by the record form and the account pages, so a typo is caught
// next to the field instead of coming back as a Cloudflare error.

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

// Underscores are allowed by default because real targets use them, such as DKIM and ACME names.
const LABEL = /^(?!-)[\p{L}\p{N}_-]{1,63}(?<!-)$/u
const STRICT_LABEL = /^(?!-)[\p{L}\p{N}-]{1,63}(?<!-)$/u

export const isIpv4 = (value) => IPV4.test(String(value ?? ''))

// The URL parser implements the full IPv6 grammar, including :: and embedded IPv4.
export const isIpv6 = (value) => {
	const text = String(value ?? '')
	if (!text.includes(':') || !/^[\da-f:.]+$/i.test(text)) return false
	try {
		return Boolean(new URL(`http://[${text}]/`))
	} catch {
		return false
	}
}

export const isIp = (value) => isIpv4(value) || isIpv6(value)

// Accepts the fully qualified form with a trailing dot.
export const isHostname = (value, { allowUnderscore = true } = {}) => {
	const text = String(value ?? '')
	const host = text.endsWith('.') ? text.slice(0, -1) : text
	const label = allowUnderscore ? LABEL : STRICT_LABEL
	return host.length > 0 && host.length <= 253 && host.split('.').every((part) => label.test(part))
}
