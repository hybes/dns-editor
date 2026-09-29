// The cf command line that does what the console is about to do, for copying into a terminal.

const PLAIN = /^[A-Za-z0-9@%+=:,./_-]+$/

// Leaves plain values bare and single-quotes the rest, as a POSIX shell expects.
export const shellQuote = (value) => {
	const text = String(value)
	return text && PLAIN.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`
}

const isSet = (value) =>
	Array.isArray(value) ? value.some(isSet) : value !== undefined && value !== null && value !== ''

const asText = (value) => (typeof value === 'object' ? JSON.stringify(value) : String(value))

// Whether the command acts on a zone given the account-or-zone choice, as cf's --zone decides.
export const actsOnZone = (command, target) =>
	command?.scope === 'zone' || (command?.scope === 'accountOrZone' && target === 'zone')

export const needsAccount = (command, target) =>
	command?.scope === 'account' || (command?.scope === 'accountOrZone' && target !== 'zone')

// values: { [argOrFlagName]: value }; zone: the zone's name (cf accepts names); account: an
// account ID, which cf reads from CLOUDFLARE_ACCOUNT_ID rather than a flag.
export function cfCommandLine(command, { values = {}, zone = '', account = '', target, body, files = {} } = {}) {
	if (!command) return ''
	const parts = ['cf', ...command.command.split(' ')]

	for (const arg of command.args || []) {
		const value = values[arg.name]
		if (!isSet(value)) {
			if (arg.required) parts.push(`<${arg.name}>`)
			continue
		}
		for (const item of Array.isArray(value) ? value.filter(isSet) : [value]) parts.push(shellQuote(asText(item)))
	}

	if (actsOnZone(command, target)) parts.push('--zone', zone ? shellQuote(zone) : '<zone>')

	for (const flag of command.flags || []) {
		const value = values[flag.name]
		if (!isSet(value)) continue
		if (flag.type === 'boolean' && !flag.format) {
			parts.push(value === true || value === 'true' ? `--${flag.name}` : `--no-${flag.name}`)
			continue
		}
		const items = flag.array && Array.isArray(value) ? value.filter(isSet) : [value]
		for (const item of items) parts.push(`--${flag.name}`, shellQuote(asText(item)))
	}

	for (const field of (command.form || []).filter((item) => item.file)) {
		if (files[field.field]) parts.push('--file', shellQuote(files[field.field].name || field.field))
	}
	if (isSet(body)) parts.push('--body', shellQuote(typeof body === 'string' ? body.trim() : JSON.stringify(body)))

	const line = parts.join(' ')
	return needsAccount(command, target) && account ? `CLOUDFLARE_ACCOUNT_ID=${shellQuote(account)} ${line}` : line
}
