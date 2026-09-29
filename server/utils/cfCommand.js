import { createError } from 'h3'
import { findCfCommand, findLocalCommand } from './cfCatalogue'
import { cfFetch, cfFetchMultipart, cfFetchRaw } from './cfFetch'
import { isCloudflareId } from './ids'

// Runs Cloudflare API operations by their cf command name ('dns records list'), building the
// same request the cf CLI would send for the same flags. Every route in this app goes through
// here, so API paths and field names come from cf's catalogue rather than being typed out.
//
// Input, as the CLI would take it:
//   zone     zone ID, or a zone name as cf's --zone accepts (zone and account-or-zone commands)
//   account  account ID (account commands); defaults to the token's only account
//   accountOfZone  a zone ID whose owning account to use when no account is given, for
//            pages that know the zone but not its account
//   target   'zone' or 'account', for commands that act on either; defaults to the zone when
//            one is given, as cf does
//   args     positional arguments by name, e.g. { 'setting-id': 'ssl' }
//   flags    options by name, e.g. { type: 'A', 'per-page': 100 }
//   body     the raw request body, like cf's --body; it replaces any body flags. Commands that
//            take bytes (octet-stream) also accept a Buffer
//   files    multipart file fields by name: { file: { name, text } } or { name, base64 }

const API_BASE = 'https://api.cloudflare.com/client/v4'
const ZONE_LOOKUP_TTL_MS = 60_000
const ACCOUNTS_TTL_MS = 60_000

const badRequest = (statusMessage) => createError({ statusCode: 400, message: statusMessage })

// The command, or a 400 that says why it can't run here.
export async function requireCfCommand(name) {
	if (typeof name !== 'string' || !name.trim()) throw badRequest('Name a cf command')
	const command = await findCfCommand(name)
	if (command) return command
	const local = await findLocalCommand(name)
	if (local) {
		throw badRequest(`cf ${local.command} runs on your own machine, not through the Cloudflare API.`)
	}
	throw createError({ statusCode: 404, message: `cf has no command called “${String(name || '').trim()}”` })
}

// --- Values ---------------------------------------------------------------------------------

const isSet = (value) => value !== undefined && value !== null && value !== ''

const flagLabel = (input) => (input.positional ? `<${input.name}>` : `--${input.name}`)

// Arguments and flags in the order the CLI lists them, arguments marked as positional.
const inputsOf = (command) => [...command.args.map((arg) => ({ ...arg, positional: true })), ...command.flags]

const parseJson = (text, label) => {
	try {
		return JSON.parse(text)
	} catch (error) {
		throw badRequest(`${label} isn’t valid JSON: ${error.message}`)
	}
}

// One value converted the way yargs and cf's body helpers do: numbers and booleans typed,
// JSON-valued flags parsed, and choices checked.
const typed = (input, value, label) => {
	if (input.type === 'number') {
		const number = typeof value === 'number' ? value : Number(String(value).trim())
		if (!Number.isFinite(number)) throw badRequest(`${label} must be a number`)
		return number
	}
	if (input.type === 'boolean') {
		if (value === true || value === 'true') return true
		if (value === false || value === 'false') return false
		throw badRequest(`${label} must be true or false`)
	}
	if (typeof value === 'object') throw badRequest(`${label} must be text`)
	return String(value)
}

const convertOne = (input, value) => {
	const label = flagLabel(input)
	if (input.format === 'objects') {
		const list = typeof value === 'string' ? parseJson(value, label) : value
		if (!Array.isArray(list) || list.some((item) => !item || typeof item !== 'object')) {
			throw badRequest(`${label} must be a JSON array of objects`)
		}
		return list
	}
	if (input.format === 'json') return typeof value === 'string' ? parseJson(value, label) : value
	const converted = typed(input, value, label)
	if (input.enum?.length && !input.enum.some((choice) => String(choice) === String(converted))) {
		throw badRequest(`${label} must be one of: ${input.enum.join(', ')}`)
	}
	return converted
}

const convert = (input, value) => {
	if (!input.array) {
		if (Array.isArray(value) && input.format !== 'objects' && input.format !== 'json') {
			throw badRequest(`${flagLabel(input)} takes one value`)
		}
		return convertOne(input, value)
	}
	const list = (Array.isArray(value) ? value : [value]).filter(isSet)
	return list.map((item) => convertOne(input, item))
}

const setNested = (target, key, value) => {
	let node = target
	for (const part of key.slice(0, -1)) {
		if (!node[part] || typeof node[part] !== 'object' || Array.isArray(node[part])) node[part] = {}
		node = node[part]
	}
	node[key[key.length - 1]] = value
}

const encodeQuery = (entries) => {
	const params = new URLSearchParams()
	for (const [key, value] of entries) {
		for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item))
	}
	const text = params.toString()
	return text ? `?${text}` : ''
}

// Header values can't carry line breaks; anything else Cloudflare checks itself.
const headerValue = (input, value) => {
	const text = String(value)
	if (/[\r\n]/.test(text)) throw badRequest(`${flagLabel(input)} can’t contain line breaks`)
	return text
}

const readFile = (field, file) => {
	if (typeof file === 'string') return new Blob([file])
	if (!file || typeof file !== 'object') throw badRequest(`The ${field} file is missing`)
	if (typeof file.base64 === 'string') return new Blob([Buffer.from(file.base64, 'base64')])
	if (typeof file.text === 'string') return new Blob([file.text])
	throw badRequest(`The ${field} file is missing`)
}

// --- Zone and account -----------------------------------------------------------------------
// These look-ups are themselves cf commands that need no zone or account, so they never loop.

// cf's --zone takes an ID or a zone name. Names are looked up among the token's zones.
async function resolveZoneId(apiKey, zone) {
	const value = String(zone || '').trim()
	if (!value) throw badRequest('Choose a zone for this command')
	if (/^[0-9a-f]{32}$/i.test(value)) return value
	if (!/^[a-z0-9.-]+$/i.test(value)) throw badRequest(`“${value}” isn’t a zone name or ID`)
	const data = await cfCommand({
		apiKey,
		command: 'zones list',
		flags: { name: value.toLowerCase(), 'per-page': 5 },
		cacheTtl: ZONE_LOOKUP_TTL_MS
	})
	if (!data?.success) throw Object.assign(new Error('zone lookup failed'), { envelope: data })
	const match = (data.result || []).find((item) => item?.name === value.toLowerCase())
	if (!match?.id) throw badRequest(`This token can’t see a zone called ${value}`)
	return match.id
}

// cf uses the account in CLOUDFLARE_ACCOUNT_ID, or the token's only account.
async function resolveAccountId(apiKey, account, accountOfZone) {
	const value = String(account || '').trim()
	if (value) {
		if (!isCloudflareId(value)) throw badRequest(`“${value}” isn’t a Cloudflare account ID`)
		return value
	}
	if (accountOfZone) {
		const zone = await cfCommand({
			apiKey,
			command: 'zones get',
			zone: accountOfZone,
			cacheTtl: ZONE_LOOKUP_TTL_MS
		})
		if (!zone?.success) throw Object.assign(new Error('zone lookup failed'), { envelope: zone })
		if (!zone.result?.account?.id) throw badRequest('Cloudflare didn’t say which account owns this zone')
		return zone.result.account.id
	}
	const data = await cfCommand({
		apiKey,
		command: 'accounts list',
		flags: { 'per-page': 50 },
		cacheTtl: ACCOUNTS_TTL_MS
	})
	if (!data?.success) throw Object.assign(new Error('account lookup failed'), { envelope: data })
	const accounts = data.result || []
	if (accounts.length === 1 && accounts[0]?.id) return accounts[0].id
	if (!accounts.length) {
		// Tokens scoped to zones can't list accounts, but each zone names the account that owns it.
		const zones = await cfCommand({
			apiKey,
			command: 'zones list',
			flags: { 'per-page': 50 },
			cacheTtl: ACCOUNTS_TTL_MS
		})
		const owners = [...new Set((zones?.result || []).map((zone) => zone?.account?.id).filter(Boolean))]
		if (owners.length === 1) return owners[0]
		if (owners.length > 1) {
			throw badRequest(`This token’s zones belong to ${owners.length} accounts. Choose one for this command.`)
		}
		throw badRequest('This token can’t see any accounts')
	}
	throw badRequest(`This token can use ${accounts.length} accounts. Choose one for this command.`)
}

// --- Request --------------------------------------------------------------------------------

// The account-or-zone commands act on the zone when one is given, as cf's --zone does.
const actsOnZone = (command, { zone, target }) =>
	command.scope === 'zone' || (command.scope === 'accountOrZone' && (target ? target === 'zone' : isSet(zone)))

// The API path with each {placeholder} filled; path arguments are URL-encoded, as cf does.
// Arguments marked `slashes: 'literal'`, such as an R2 object key, keep their slashes, as
// Cloudflare's spec requires; cf encodes those too.
const fillPath = (command, { zoneId, accountId, onZone, pathParams }) =>
	command.params.reduce((text, param) => {
		let value
		if (param.from === 'zone') value = zoneId
		else if (param.from === 'account') value = accountId
		else if (param.from === 'accountOrZone') value = onZone ? 'zones' : 'accounts'
		else if (param.from === 'accountOrZoneId') value = onZone ? zoneId : accountId
		else {
			value = pathParams[param.param]
			const label = `<${param.param.replace(/_/g, '-')}>`
			if (!isSet(value)) throw badRequest(`${label} is required`)
			const literal = inputsOf(command).some((input) => input.key === param.param && input.slashes === 'literal')
			const parts = literal ? String(value).split('/') : [String(value)]
			// Encoding leaves dots alone, and a URL reads a part that's only . or .. as a folder.
			if (parts.some((part) => part === '.' || part === '..')) {
				throw badRequest(literal ? `${label} can’t have a folder called . or ..` : `${label} can’t be . or ..`)
			}
			value = parts.map(encodeURIComponent).join('/')
		}
		return text.replace(`{${param.param}}`, value)
	}, command.path)

// The checks yargs makes before cf runs a command: flags that can't be combined (usually
// alternative body shapes), flags that need others, and groups where setting any flag needs
// the group's required ones. `given(name)` says whether a flag has a value.
const checkFlagRules = (command, given) => {
	const rules = command.rules
	if (!rules) return
	for (const [flag, others] of rules.conflicts || []) {
		const clash = given(flag) && others.find(given)
		if (clash) throw badRequest(`--${flag} and --${clash} can’t be used together`)
	}
	for (const [flag, needed] of rules.implies || []) {
		const missing = given(flag) ? needed.filter((name) => !given(name)) : []
		if (missing.length) throw badRequest(`--${flag} also needs ${missing.map((name) => `--${name}`).join(', ')}`)
	}
	for (const group of rules.groups || []) {
		const missing = group.when.some(given) ? group.require.filter((name) => !given(name)) : []
		if (missing.length) {
			const names = missing.map((name) => `--${name}`).join(', ')
			const when = group.prefix ? ` when any --${group.prefix}-* flag is set` : ''
			throw badRequest(`${names} ${missing.length === 1 ? 'is' : 'are'} required${when}`)
		}
	}
}

// Builds the request cf would send. Returns { method, path, query, headers, bodyKind, body,
// form, rawBody, contentType, pathParams, queryValues } with IDs and names resolved.
export async function buildCfRequest(
	command,
	{ apiKey, zone, account, accountOfZone, target, args, flags, body, files } = {}
) {
	const values = { ...(flags || {}), ...(args || {}) }
	const rawBody = isSet(body) ? body : undefined

	const onZone = actsOnZone(command, { zone, target })
	const needsAccount = command.params.some(
		(param) => param.from === 'account' || (param.from === 'accountOrZoneId' && !onZone)
	)
	const given = (name) => {
		const value = values[name]
		return Array.isArray(value) ? value.some(isSet) : isSet(value)
	}
	checkFlagRules(command, given)

	const pathParams = {}
	const queryEntries = []
	const headers = {}
	const formFields = []
	let bodyValue = command.bodyKind === 'json' ? {} : undefined
	let bodyFlagsUsed = false

	for (const input of inputsOf(command)) {
		const raw = values[input.name]
		if (!given(input.name)) {
			// cf checks required body fields only when --body isn't given.
			const needed = input.required && !(input.in === 'body' && rawBody !== undefined)
			if (needed) {
				throw badRequest(
					input.in === 'body'
						? `${flagLabel(input)} is required (or pass the request body as JSON)`
						: `${flagLabel(input)} is required`
				)
			}
			continue
		}
		const value = convert(input, raw)
		if (input.in === 'path') pathParams[input.key] = value
		else if (input.in === 'query') queryEntries.push([input.key, value])
		else if (input.in === 'header') headers[input.key] = headerValue(input, value)
		else if (input.in === 'form') formFields.push([input.key, value])
		else if (input.in === 'body' && rawBody === undefined) {
			bodyFlagsUsed = true
			if (input.key.length) setNested(bodyValue, input.key, value)
			else bodyValue = value
		}
	}

	const payload = {}
	if (command.bodyKind === 'json') {
		if (rawBody !== undefined) {
			payload.body = typeof rawBody === 'string' ? parseJson(rawBody, 'The request body') : rawBody
		} else if (bodyFlagsUsed || command.flags.some((flag) => flag.in === 'body')) {
			// cf sends the flags it was given, even none, when the command has body flags.
			payload.body = bodyValue
		} else {
			throw badRequest('This command needs a request body. Enter it as JSON.')
		}
	} else if (command.bodyKind === 'multipart') {
		const fileFields = (command.form || []).filter((field) => field.file)
		const provided = fileFields.filter((field) => files?.[field.field] !== undefined)
		if (!provided.length && rawBody === undefined && !formFields.length) {
			throw badRequest('This command needs a file. Choose one or paste its contents.')
		}
		const form = new FormData()
		for (const field of fileFields) {
			const file = files?.[field.field] ?? (field.field === 'file' ? rawBody : undefined)
			if (file === undefined) continue
			form.append(field.field, readFile(field.field, file), file?.name || field.field)
		}
		for (const [key, value] of formFields) {
			form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
		}
		payload.form = form
		payload.formPreview = {
			...Object.fromEntries(formFields),
			...Object.fromEntries(provided.map((field) => [field.field, files[field.field]?.name || '(file)']))
		}
	} else if (command.bodyKind === 'octet-stream') {
		if (rawBody === undefined) throw badRequest('This command needs a request body.')
		// Bytes, such as a file for `r2 objects put`, go as they are.
		payload.rawBody =
			typeof rawBody === 'string' || rawBody instanceof Uint8Array ? rawBody : JSON.stringify(rawBody)
		payload.contentType = command.contentType || 'application/octet-stream'
	}

	// Everything above is checked first, so a mistake is reported without asking Cloudflare.
	const zoneId = onZone ? await resolveZoneId(apiKey, zone) : ''
	const accountId = needsAccount ? await resolveAccountId(apiKey, account, accountOfZone) : ''

	return {
		method: command.method,
		path: fillPath(command, { zoneId, accountId, onZone, pathParams }),
		query: encodeQuery(queryEntries),
		queryValues: Object.fromEntries(queryEntries),
		headers,
		bodyKind: command.bodyKind,
		zoneId,
		accountId,
		pathParams,
		...payload
	}
}

// cf's --dry-run output for a built request.
export function describeCfRequest(command, request) {
	const description = {
		command: `cf ${command.command}`,
		method: request.method,
		url: `${API_BASE}${request.path}${request.query}`,
		pathParams: Object.fromEntries(
			[['zone_id', request.zoneId], ['account_id', request.accountId], ...Object.entries(request.pathParams)]
				.filter(([, value]) => isSet(value))
				.map(([key, value]) => [key.replace(/_/g, '-'), String(value)])
		),
		query: request.queryValues,
		bodyKind: request.bodyKind
	}
	if (Object.keys(request.headers).length) description.headers = request.headers
	if (request.body !== undefined) description.body = request.body
	if (request.formPreview) description.body = request.formPreview
	if (request.rawBody !== undefined) description.body = request.rawBody
	return description
}

// Sends a built request. Resolves to Cloudflare's envelope; commands whose answer isn't
// JSON (raw output) resolve to { success: true, result: { contentType, text | base64 } }.
export async function sendCfRequest(apiKey, command, request, { cacheTtl = 0, fresh = false, timeout } = {}) {
	const { method, path, query, headers } = request
	if (command.output === 'raw') {
		const raw = await cfFetchRaw({ apiKey, method, path, query, headers, body: request.body, timeout })
		if (!raw.success) return raw
		const { success: _success, ...result } = raw
		return { success: true, errors: [], messages: [], result }
	}
	if (request.form) return cfFetchMultipart({ apiKey, method, path, query, headers, form: request.form })
	return cfFetch({
		apiKey,
		method,
		path,
		query,
		headers,
		body: request.body,
		rawBody: request.rawBody,
		contentType: request.contentType,
		cacheTtl,
		fresh,
		timeout
	})
}

// Builds and sends in one step, for routes that call a known command. Failures while looking
// up a zone name or the token's account come back as Cloudflare's envelope, like any other.
export async function cfCommand({ apiKey, command: name, cacheTtl, fresh, timeout, ...input }) {
	const command = await requireCfCommand(name)
	let request
	try {
		request = await buildCfRequest(command, { apiKey, ...input })
	} catch (error) {
		if (error?.envelope) return error.envelope
		throw error
	}
	return sendCfRequest(apiKey, command, request, { cacheTtl, fresh, timeout })
}

// The API path a command acts on, for cache invalidation. Takes IDs rather than names, since
// it never calls Cloudflare, and ignores the flags that don't form part of the path.
export async function cfCommandPath(name, { zone, account, target, args, flags } = {}) {
	const command = await requireCfCommand(name)
	const values = { ...(flags || {}), ...(args || {}) }
	const pathParams = Object.fromEntries(
		inputsOf(command)
			.filter((input) => input.in === 'path' && isSet(values[input.name]))
			.map((input) => [input.key, values[input.name]])
	)
	const onZone = actsOnZone(command, { zone, target })
	return fillPath(command, { zoneId: zone, accountId: account, onZone, pathParams })
}
