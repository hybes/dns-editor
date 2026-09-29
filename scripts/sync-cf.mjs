#!/usr/bin/env node
// Builds server/cf/catalogue.json, the list of cf commands this app can run, from the
// cloudflare/cf source at a release tag.
//
//   npm run cf:sync                  latest cf release on npm
//   npm run cf:sync -- 1.0.0-beta.5  a specific release
//
// cf's published _meta/commands.json names every command, its flags and its API path, but
// not where each flag goes in the request (query string, header or which nested body field).
// That only exists in cf's generated command files, so this reads the `formatDryRun({...})`
// block each one contains, which states the request cf would send, and records the mapping
// the server needs to send the same request.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'https://github.com/cloudflare/cf'
const GENERATED = 'packages/cli/src/commands/_generated'
const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'cf', 'catalogue.json')

const run = (command, args, options = {}) =>
	execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()

const version = process.argv[2] || run('npm', ['view', 'cf', 'version'])
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`Not a cf version: ${version}`)

// --- Source -------------------------------------------------------------------------------

const checkout = mkdtempSync(join(tmpdir(), 'cf-sync-'))
process.on('exit', () => rmSync(checkout, { recursive: true, force: true }))

console.log(`Fetching cf@${version} from ${REPO}…`)
run('git', [
	'clone',
	'--quiet',
	'--depth',
	'1',
	'--branch',
	`cf@${version}`,
	'--filter=blob:none',
	'--sparse',
	REPO,
	checkout
])
run('git', ['-C', checkout, 'sparse-checkout', 'set', GENERATED])

const generated = join(checkout, GENERATED)
const readJson = (file) => JSON.parse(readFileSync(join(generated, '_meta', file), 'utf8'))
const meta = readJson('commands.json')

// --- A small reader for cf's generated TypeScript -----------------------------------------
// The files are machine-written and regular, so matching brackets while skipping strings,
// template literals and comments is enough; no TypeScript parser is needed.

const CLOSE = { '{': '}', '(': ')', '[': ']' }

// Index just past the string, template literal or comment starting at `i`, or -1.
const skipQuoted = (src, i) => {
	const char = src[i]
	if (char === '/' && src[i + 1] === '/') return src.indexOf('\n', i) + 1 || src.length
	if (char === '/' && src[i + 1] === '*') return src.indexOf('*/', i + 2) + 2
	if (char !== '"' && char !== "'" && char !== '`') return -1
	let j = i + 1
	while (j < src.length) {
		if (src[j] === '\\') {
			j += 2
			continue
		}
		if (src[j] === char) return j + 1
		if (char === '`' && src[j] === '$' && src[j + 1] === '{') {
			j = matchBracket(src, j + 1) + 1
			continue
		}
		j++
	}
	throw new Error('Unterminated string')
}

// Index of the bracket that closes the one at `open`.
function matchBracket(src, open) {
	const stack = [CLOSE[src[open]]]
	let i = open + 1
	while (i < src.length) {
		const skipped = skipQuoted(src, i)
		if (skipped !== -1) {
			i = skipped
			continue
		}
		const char = src[i]
		if (CLOSE[char]) stack.push(CLOSE[char])
		else if (char === stack[stack.length - 1]) {
			stack.pop()
			if (!stack.length) return i
		}
		i++
	}
	throw new Error('Unbalanced brackets')
}

// Splits `src` on commas that aren't inside brackets or strings.
const splitTopLevel = (src) => {
	const parts = []
	let start = 0
	let i = 0
	while (i < src.length) {
		const skipped = skipQuoted(src, i)
		if (skipped !== -1) {
			i = skipped
			continue
		}
		if (CLOSE[src[i]]) {
			i = matchBracket(src, i) + 1
			continue
		}
		if (src[i] === ',') {
			parts.push(src.slice(start, i))
			start = i + 1
		}
		i++
	}
	parts.push(src.slice(start))
	return parts.map((part) => part.trim()).filter(Boolean)
}

// The `{...}` that follows `marker`, as source text without the braces.
const objectAfter = (src, marker, from = 0) => {
	const at = src.indexOf(marker, from)
	if (at === -1) return null
	const open = src.indexOf('{', at + marker.length - 1)
	return src.slice(open + 1, matchBracket(src, open))
}

// Reads `key: value` pairs from object literal source. Keys come back unquoted.
const entries = (body) =>
	splitTopLevel(body).map((part) => {
		const match = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(part)
		if (!match) return { spread: part }
		const key = /^["']/.test(match[1]) ? JSON.parse(`"${match[1].slice(1, -1)}"`) : match[1]
		return { key, value: match[2].trim() }
	})

// cf's catalogue spells some flags in camelCase (dateRange) while the CLI and its generated
// code use kebab-case (date-range), so names are compared in this form.
const norm = (name) =>
	String(name)
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/_/g, '-')
		.toLowerCase()

// The flag an expression reads, e.g. argv["name-exact"] or argv.file.
const flagIn = (expression) => {
	const quoted = /argv\[\s*"([^"]+)"\s*\]/.exec(expression)
	if (quoted) return quoted[1]
	const dotted = /argv\.([A-Za-z_$][\w$]*)/.exec(expression)
	return dotted ? dotted[1] : null
}

// How cf turns the flag's text into the value it sends.
const formatOf = (expression) => {
	if (expression.includes('parseObjectArray(')) return 'objects'
	if (/resolveFileToken\([\s\S]*"json"\s*\)/.test(expression)) return 'json'
	return undefined
}

// Body literal → [{ flag, key: ['value', 'pool_id'], format }]. Constants and unrecognised
// entries are reported so a new generator pattern doesn't go unnoticed.
const bodyFields = (body, warnings, prefix = []) =>
	entries(body).flatMap(({ key, value, spread }) => {
		if (spread) {
			warnings.push(`body spread: ${spread.slice(0, 60)}`)
			return []
		}
		if (value.startsWith('{')) return bodyFields(value.slice(1, -1), warnings, [...prefix, key])
		const flag = flagIn(value)
		if (!flag) {
			warnings.push(`body constant: ${key}`)
			return []
		}
		return [{ flag, key: [...prefix, key], format: formatOf(value) }]
	})

// The `${...}` expressions in the dry-run URL, in order.
const urlExpressions = (block) => {
	const at = block.indexOf('url:')
	const open = block.indexOf('`', at)
	const close = skipQuoted(block, open) - 1
	const template = block.slice(open, close)
	const found = []
	for (let i = template.indexOf('${'); i !== -1; i = template.indexOf('${', i + 1)) {
		const end = matchBracket(template, i + 1)
		found.push(template.slice(i + 2, end))
		i = end
	}
	return found
}

const PATH_SOURCES = [
	[/__cfDryRunAccountId/, { from: 'account' }],
	[/argv\.zone \?\? argv\.zoneId/, { from: 'zone' }],
	[/^accountOrZone$/, { from: 'accountOrZone' }],
	[/^accountOrZoneId$/, { from: 'accountOrZoneId' }]
]

// A double-quoted TypeScript string's value. JS allows escapes JSON doesn't, such as \`.
const readString = (literal) => JSON.parse(literal.replace(/\\(?=[`$'])/g, ''))

// The yargs .option() and .positional() names as the CLI spells them, with the details the
// catalogue leaves out.
const builderInputs = (src) => {
	const found = []
	const pattern = /\.(option|positional)\(\s*"([^"]+)"\s*,\s*\{/g
	for (let match = pattern.exec(src); match; match = pattern.exec(src)) {
		const open = match.index + match[0].length - 1
		const body = src.slice(open + 1, matchBracket(src, open))
		const type = /\btype:\s*"(\w+)"/.exec(body)?.[1]
		const description = /\bdescription:\s*("(?:[^"\\]|\\.)*")/.exec(body)?.[1]
		const choices = /\bchoices:\s*(\[[^\]]*\])/.exec(body)?.[1]
		found.push({
			name: match[2],
			positional: match[1] === 'positional',
			array: /\barray:\s*true/.test(body),
			...(type && { type }),
			...(description && { description: readString(description) }),
			...(choices && { enum: JSON.parse(choices.replace(/,\s*\]$/, ']')) })
		})
	}
	return found
}

// yargs rules between flags: .conflicts(a, [b]) (a can't be used with b), .implies(a, [b])
// (a needs b), and cf's .check() groups (setting any flag in a group needs all its required
// ones). Returns { conflicts, implies, groups } with only the kinds the command has.
const flagRules = (src) => {
	const rules = {}
	for (const kind of ['conflicts', 'implies']) {
		const pattern = new RegExp(`\\.${kind}\\(\\s*"([^"]+)"\\s*,\\s*\\[([^\\]]*)\\]`, 'g')
		const found = [...src.matchAll(pattern)].map((match) => [
			match[1],
			JSON.parse(`[${match[2].replace(/,\s*$/, '')}]`)
		])
		if (found.length) rules[kind] = found
	}
	const groups = []
	for (const match of src.matchAll(/\.check\(/g)) {
		const open = src.indexOf('(', match.index)
		const body = src.slice(open, matchBracket(src, open))
		const list = (name) => {
			const found = new RegExp(`const ${name} = (\\[[^\\]]*\\])`).exec(body)?.[1]
			return found ? JSON.parse(found.replace(/,\s*\]$/, ']')) : null
		}
		const when = list('groupSet')
		const require = list('missing')
		const prefix = /when any --([^*]+)-\* flag/.exec(body)?.[1]
		if (when && require) groups.push({ when, require, ...(prefix && { prefix }) })
	}
	if (groups.length) rules.groups = groups
	return rules
}

// --- Per command --------------------------------------------------------------------------

const scopeOf = (apiPath) => {
	if (apiPath.startsWith('/{account_or_zone}/')) return 'accountOrZone'
	if (apiPath.startsWith('/zones/{zone_id}')) return 'zone'
	if (/^\/accounts\/\{account_id\w*\}/.test(apiPath)) return 'account'
	return 'none'
}

const describeInput = (item) => {
	const clean = { type: item.type || 'string' }
	if (item.required) clean.required = true
	if (item.description) clean.description = item.description
	if (item.enum?.length) clean.enum = item.enum
	if (item.default !== undefined) clean.default = item.default
	if (item.alias) clean.alias = item.alias
	return clean
}

// Flags the console handles itself rather than as fields, unless the request reads them.
const CONTROL_FLAGS = new Set(['dry-run', 'body', 'force', 'help', 'file', 'text'])
// How the spec marks a path value whose slashes are sent as they are: "Slashes (`/`) within
// the key MUST be sent literally".
const LITERAL_SLASHES = /\bslashes\b[\s\S]*?\bmust be sent literally\b/i

const warningsByCommand = {}

const readCommand = (command) => {
	const name = command.command.replace(/^cf /, '')
	const warnings = []
	const stem = join(generated, ...command.fullPath)
	const file = [`${stem}.ts`, join(stem, 'index.ts')].find((candidate) => existsSync(candidate))
	const src = file ? readFileSync(file, 'utf8') : ''

	const entry = {
		command: name,
		summary: command.summary || command.description?.split('\n')[0] || '',
		description: command.description || '',
		category: command.category,
		method: command.httpMethod,
		path: command.apiPath,
		scope: scopeOf(command.apiPath),
		bodyKind: command.hasRequestBody ? 'json' : 'none'
	}
	if (command.hideCommand) entry.hidden = true

	// Every input the command takes, keyed by normalised name. The builder's spelling wins,
	// since it's what the CLI accepts; the catalogue's details win, since they're fuller.
	const inputs = new Map()
	for (const item of builderInputs(src)) {
		inputs.set(norm(item.name), {
			name: item.name,
			...describeInput(item),
			...(item.positional && { positional: true }),
			...(item.array && { array: true })
		})
	}
	const withDetails = (item, extra) => {
		const key = norm(item.name)
		const current = inputs.get(key)
		inputs.set(key, { ...current, ...describeInput(item), name: current?.name || item.name, ...extra })
	}
	for (const arg of command.arguments || []) withDetails(arg, { positional: true, position: arg.position })
	for (const option of command.options || []) withDetails(option)
	const input = (raw) => (raw ? inputs.get(norm(raw)) : undefined)
	const place = (raw, where, detail) => {
		const found = input(raw)
		if (!found) return false
		Object.assign(found, { in: where }, detail)
		return true
	}

	const dryRunAt = src.indexOf('formatDryRun({')
	if (!file || dryRunAt === -1) {
		// Hand-written commands (such as `ai run`) have no generated request to read, so only
		// their raw --body form is offered.
		warnings.push(file ? 'no dry-run block' : 'no generated file')
		const placeholders = [...command.apiPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])
		entry.params = placeholders.map((param) => {
			if (param === 'account_id') return { param, from: 'account' }
			if (param === 'zone_id') return { param, from: 'zone' }
			const arg = [...inputs.values()].find((item) => norm(item.name) === norm(param))
			if (arg) Object.assign(arg, { in: 'path', key: param })
			return { param, from: 'arg', flag: arg?.name || param }
		})
		entry.handWritten = true
	} else {
		const block = objectAfter(src, 'formatDryRun({')

		// Path: each {placeholder} in the API path lines up with a ${...} in the dry-run URL.
		const placeholders = [...command.apiPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])
		const expressions = urlExpressions(block)
		if (placeholders.length !== expressions.length) {
			warnings.push(`path has ${placeholders.length} placeholders, URL has ${expressions.length}`)
		}
		entry.params = placeholders.map((param, index) => {
			const expression = expressions[index] || ''
			for (const [pattern, source] of PATH_SOURCES) if (pattern.test(expression)) return { param, ...source }
			const raw = flagIn(expression)
			if (!place(raw, 'path', { key: param })) {
				warnings.push(`unknown path source for {${param}}`)
				return { param, from: 'arg', flag: raw || param }
			}
			return { param, from: 'arg', flag: input(raw).name }
		})

		// Query string.
		const query = objectAfter(src, 'const queryParams')
		if (query) {
			for (const { key, value } of entries(query)) {
				if (!place(flagIn(value || ''), 'query', { key })) warnings.push(`query ${key} has no flag`)
			}
		}

		// Headers set from flags, e.g. headers["Prefer"] = String(argv["prefer"]).
		for (const match of src.matchAll(/headers\["([^"]+)"\]\s*=\s*String\(\s*(argv[^)]+)\)/g)) {
			place(flagIn(match[2]), 'header', { key: match[1] })
		}

		// Body. A few commands pick the kind from a flag, as in
		// `argv.file !== undefined ? "octet-stream" : "json"`; the console offers the default,
		// which is the last one named.
		const kindSource = /bodyKind:\s*([^\n]+)/.exec(block)?.[1] || ''
		const kind = [...kindSource.matchAll(/"([\w-]+)"/g)].pop()?.[1] || 'none'
		entry.bodyKind = kind
		const bodyAt = block.search(/\n\s*body:/)
		const bodySrc = bodyAt === -1 ? '' : block.slice(bodyAt).replace(/^\s*body:\s*/, '')
		if (kind === 'json') {
			const compact = bodySrc.indexOf('compactBody(')
			if (compact !== -1) {
				const open = bodySrc.indexOf('(', compact)
				const inner = bodySrc.slice(open + 1, matchBracket(bodySrc, open)).trim()
				if (inner.startsWith('{')) {
					for (const field of bodyFields(inner.slice(1, -1), warnings)) {
						const placed = place(field.flag, 'body', {
							key: field.key,
							...(field.format && { format: field.format })
						})
						if (!placed) warnings.push(`body field ${field.key.join('.')} reads unknown flag ${field.flag}`)
					}
				} else if (!place(flagIn(inner), 'body', { key: [], format: formatOf(inner) || 'json' })) {
					warnings.push('body is neither an object nor a flag')
				}
			}
		} else if (kind === 'multipart') {
			const open = bodySrc.indexOf('{')
			const fields = open === -1 ? [] : entries(bodySrc.slice(open + 1, matchBracket(bodySrc, open)))
			entry.form = []
			for (const { key, value } of fields) {
				const raw = flagIn(value || '')
				// --body stands in for the file's content, so the console offers it as the file field.
				if (raw === 'body') continue
				if (raw === 'file') {
					entry.form.push({ field: key, file: true })
					continue
				}
				if (!place(raw, 'form', { key })) warnings.push(`form field ${key} has no flag`)
			}
		} else if (kind === 'octet-stream') {
			const type = /"Content-Type":\s*"([^"]+)"/.exec(src)?.[1]
			if (type) entry.contentType = type
		}
	}

	if (src.includes('fetchRawBytes(')) entry.output = 'raw'

	const rules = flagRules(src)
	if (Object.keys(rules).length) entry.rules = rules

	const force = inputs.get('force')
	if (force && !force.in) entry.confirm = true

	entry.args = []
	entry.flags = []
	for (const item of inputs.values()) {
		const key = norm(item.name)
		if (!item.in) {
			if (!CONTROL_FLAGS.has(key))
				warnings.push(`${item.positional ? 'argument' : 'flag'} ${item.name} isn't used`)
			continue
		}
		const { positional, position: _position, ...rest } = item
		// Cloudflare's spec says some path values keep their slashes (R2 object keys); cf
		// encodes them anyway.
		if (rest.in === 'path' && LITERAL_SLASHES.test(rest.description || '')) rest.slashes = 'literal'
		;(positional ? entry.args : entry.flags).push(rest)
	}
	// Positional arguments in the order the CLI takes them.
	const position = (arg) => inputs.get(norm(arg.name))?.position ?? Infinity
	entry.args.sort((a, b) => position(a) - position(b))
	if (warnings.length) warningsByCommand[name] = warnings
	return entry
}

const commands = meta.commands.filter((command) => command.apiPath).map(readCommand)

// Local-only commands (dev, deploy, tunnels run…) can't run from a web server; listing them
// lets the console explain that instead of saying the command doesn't exist.
const local = meta.commands
	.filter((command) => !command.apiPath)
	.map((command) => ({ command: command.command.replace(/^cf /, ''), summary: command.summary || '' }))
const handWritten = readJson('hand-written-commands.json')
	.commands.filter((command) => !command.handWritten?.overrides)
	.map((command) => ({
		command: command.command.replace(/^cf /, ''),
		summary: command.summary || command.description?.split('\n')[0] || ''
	}))
const localCommands = [...new Map([...local, ...handWritten].map((item) => [item.command, item])).values()].sort(
	(a, b) => a.command.localeCompare(b.command)
)

commands.sort((a, b) => a.command.localeCompare(b.command))

// One command per line keeps diffs readable when cf is updated.
const lines = [
	'{',
	`"version":${JSON.stringify(version)},`,
	`"source":${JSON.stringify(`${REPO}/tree/cf@${version}`)},`,
	`"groups":${JSON.stringify(meta.descriptions || {})},`,
	`"local":${JSON.stringify(localCommands)},`,
	'"commands":[',
	commands.map((command) => JSON.stringify(command)).join(',\n'),
	']',
	'}'
]
writeFileSync(OUTPUT, `${lines.join('\n')}\n`)

const warned = Object.entries(warningsByCommand)
console.log(`Wrote ${commands.length} commands from cf@${version} to ${OUTPUT}`)
if (warned.length) {
	console.log(`${warned.length} commands need a look (the console still offers them with --body):`)
	for (const [name, warnings] of warned) console.log(`  ${name}: ${warnings.join('; ')}`)
}
