import { domainToASCII } from 'node:url'
import { isIP } from 'node:net'

// Shared parsing/validation for names typed into the DNS lookup and domain search
// tools. Everything here is input hygiene: a value is only interpolated into an
// outbound URL after it has passed one of these checks.

const MAX_NAME_LENGTH = 253
const MAX_LABEL_LENGTH = 63

// Second-level suffixes that behave like a TLD for registration purposes. Only the
// common ones are listed; anything else is treated as "last label is the TLD".
const SECOND_LEVEL_SUFFIXES = new Set([
	'co.uk',
	'org.uk',
	'me.uk',
	'ltd.uk',
	'plc.uk',
	'ac.uk',
	'gov.uk',
	'com.au',
	'net.au',
	'org.au',
	'co.nz',
	'net.nz',
	'org.nz',
	'co.jp',
	'ne.jp',
	'or.jp',
	'com.br',
	'net.br',
	'co.za',
	'org.za',
	'com.mx',
	'co.in',
	'net.in',
	'org.in',
	'com.sg',
	'com.hk',
	'com.tw',
	'com.tr',
	'com.ar',
	'com.cn',
	'co.kr',
	'co.il',
	'com.ua'
])

// Lower-case, drop a scheme/path if a URL was pasted, and trim stray dots/space.
export const stripInput = (value) =>
	String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
		.split(/[/?#]/)[0]
		.replace(/^\.+|\.+$/g, '')

const expandIpv6 = (ip) => {
	// Strip an IPv4-mapped tail (::ffff:1.2.3.4) into hex groups first.
	let value = ip
	const v4Match = value.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
	if (v4Match) {
		const [, a, b, c, d] = v4Match.map(Number)
		const hi = ((a << 8) | b).toString(16)
		const lo = ((c << 8) | d).toString(16)
		value = value.replace(v4Match[0], `${hi}:${lo}`)
	}
	const [head, tail = ''] = value.split('::')
	const headParts = head ? head.split(':') : []
	const tailParts = tail ? tail.split(':') : []
	const missing = 8 - headParts.length - tailParts.length
	const parts = [...headParts, ...Array.from({ length: Math.max(missing, 0) }, () => '0'), ...tailParts]
	return parts.map((p) => p.padStart(4, '0')).join('')
}

// Build the in-addr.arpa / ip6.arpa name for a PTR query.
export function reverseName(ip) {
	const version = isIP(ip)
	if (version === 4) return `${ip.split('.').reverse().join('.')}.in-addr.arpa`
	if (version === 6) return `${expandIpv6(ip).split('').reverse().join('.')}.ip6.arpa`
	return ''
}

const validateLabels = (name, { allowUnderscore }) => {
	if (name.length > MAX_NAME_LENGTH) return 'Name is longer than 253 characters.'
	const labelPattern = allowUnderscore ? /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/ : /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
	for (const label of name.split('.')) {
		if (!label) return 'Name contains an empty label (check for double dots).'
		if (label.length > MAX_LABEL_LENGTH) return 'A label is longer than 63 characters.'
		if (!labelPattern.test(label)) return `“${label}” is not a valid DNS label.`
	}
	return ''
}

// A hostname to send to a resolver. Underscore labels are allowed (_dmarc, _acme-challenge)
// and an IP address is turned into its reverse-lookup name. With allowWildcard, a leading
// "*." is kept and flagged so the caller can decide which concrete name to ask about.
export function normaliseLookupName(input, { allowWildcard = false } = {}) {
	const raw = stripInput(input)
	if (!raw) return { error: 'Enter a domain name or IP address to look up.' }

	if (isIP(raw)) {
		return { name: reverseName(raw), reverse: true, wildcard: false, original: raw }
	}

	const wildcard = raw.startsWith('*.')
	if (wildcard && !allowWildcard) {
		return { error: 'Wildcard names can’t be looked up directly. Enter a name the wildcard covers instead.' }
	}

	const ascii = domainToASCII(wildcard ? raw.slice(2) : raw)
	if (!ascii) return { error: 'That does not look like a valid domain name.' }

	const problem = validateLabels(ascii, { allowUnderscore: true })
	if (problem) return { error: problem }

	return { name: wildcard ? `*.${ascii}` : ascii, reverse: false, wildcard, original: raw }
}

// Split a registrable name into base label(s) and its TLD (honouring co.uk style suffixes).
export function splitDomain(name) {
	const labels = name.split('.')
	if (labels.length < 2) return { base: name, tld: '' }
	const lastTwo = labels.slice(-2).join('.')
	if (labels.length >= 3 && SECOND_LEVEL_SUFFIXES.has(lastTwo)) {
		return { base: labels.slice(0, -2).join('.'), tld: lastTwo }
	}
	return { base: labels.slice(0, -1).join('.'), tld: labels[labels.length - 1] }
}

// A name someone might register: hostname labels only, no underscores, no wildcards.
export function normaliseSearchTerm(input) {
	const raw = stripInput(input)
	if (!raw) return { error: 'Enter a name to search for.' }

	const ascii = domainToASCII(raw)
	if (!ascii) return { error: 'That does not look like a valid domain name.' }

	const problem = validateLabels(ascii, { allowUnderscore: false })
	if (problem) return { error: problem }

	const { base, tld } = splitDomain(ascii)
	if (!base) return { error: 'Enter a name before the domain ending.' }
	if (tld && !/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)(?:\.[a-z]{2,63})?$/.test(tld)) {
		return { error: `“.${tld}” is not a valid domain ending.` }
	}

	return { name: ascii, base, tld, original: raw }
}

// Validate a TLD chosen in the search UI (e.g. "com" or "co.uk").
export function normaliseTld(input) {
	const raw = stripInput(input).replace(/^\.+/, '')
	if (!raw) return ''
	const ascii = domainToASCII(raw)
	if (!ascii) return ''
	if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)(?:\.[a-z]{2,63})?$/.test(ascii)) return ''
	return ascii
}
