import { createError } from 'h3'
import { cfFetch } from './cfFetch'
import { readId } from './ids'
import { readJsonBody } from './readJsonBody'

// Shared by the account-scoped routes (Turnstile, DNS Views, DNS Firewall). The client only
// knows the zone in the URL, so each route finds the zone's account before doing anything.

// Zones rarely move between accounts, so one lookup a minute is plenty. cfFetch never caches
// failures, so a retry still goes back to Cloudflare.
const ZONE_LOOKUP_TTL_MS = 60_000

const badRequest = (statusMessage) => createError({ statusCode: 400, statusMessage })

// Reads the body and checks the fields every account route needs; pass idKey/idLabel for
// routes that act on one item. Throws a 400 for missing or malformed input.
// Returns { body, apiKey, zoneId, id } with the IDs trimmed.
export async function readAccountBody(event, { idKey, idLabel } = {}) {
	const raw = await readJsonBody(event)
	const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
	const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
	if (!apiKey) throw badRequest('API key is required')
	const zoneId = readId(body.currZone, 'Zone ID')
	const id = idKey ? readId(body[idKey], idLabel || idKey) : ''
	return { body, apiKey, zoneId, id }
}

// Returns { accountId, failure }. `failure` is a Cloudflare error envelope for the route to
// return unchanged, so the page shows Cloudflare's own message.
export async function resolveAccountId({ apiKey, zoneId }) {
	const zone = await cfFetch({ apiKey, method: 'GET', path: `/zones/${zoneId}`, cacheTtl: ZONE_LOOKUP_TTL_MS })
	if (!zone?.success) return { accountId: '', failure: zone }
	const accountId = zone.result?.account?.id || ''
	if (!accountId) {
		return {
			accountId: '',
			failure: { success: false, errors: [{ message: 'Cloudflare didn’t say which account owns this zone' }] }
		}
	}
	return { accountId, failure: null }
}

// Turns optional `page` and `per_page` body fields into a query string, within the limits
// Cloudflare sets for that list. Returns '' when neither is sent.
export function accountListQuery(body, { minPerPage = 1, maxPerPage = 100 } = {}) {
	const limits = { page: [1, Number.MAX_SAFE_INTEGER], per_page: [minPerPage, maxPerPage] }
	const params = new URLSearchParams()
	for (const [key, [min, max]] of Object.entries(limits)) {
		const value = body[key]
		if (value === undefined || value === null || value === '') continue
		const number = Number(value)
		if (!Number.isInteger(number) || number < min || number > max) {
			throw badRequest(
				key === 'page'
					? 'page must be a whole number of 1 or more'
					: `per_page must be a whole number from ${min} to ${max}`
			)
		}
		params.set(key, String(number))
	}
	const query = params.toString()
	return query ? `?${query}` : ''
}

// The create or update data sent under `key`, which must be a JSON object.
export function readAccountPayload(body, key, label) {
	const payload = body[key]
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		throw badRequest(`${label} must be a JSON object`)
	}
	return payload
}

// Field checks for create and update payloads. Each throws a 400 that names the field and
// returns the cleaned value; optional checks return undefined when the field is absent.
export const accountFields = {
	text(value, label, { max = 255 } = {}) {
		const text = typeof value === 'string' ? value.trim() : ''
		if (!text) throw badRequest(`${label} is required`)
		if (text.length > max) throw badRequest(`${label} must be ${max} characters or fewer`)
		return text
	},
	list(value, label, { min = 1, max = Infinity } = {}) {
		if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
			throw badRequest(`${label} must be a list of text values`)
		}
		if (value.length < min) {
			throw badRequest(min === 1 ? `${label} can't be empty` : `${label} needs at least ${min} entries`)
		}
		if (value.length > max) throw badRequest(`${label} can have at most ${max} entries`)
		return value.map((item) => item.trim())
	},
	oneOf(value, label, allowed, { required = false } = {}) {
		if (value === undefined) {
			if (required) throw badRequest(`${label} is required`)
			return undefined
		}
		if (!allowed.includes(value)) throw badRequest(`${label} must be one of: ${allowed.join(', ')}`)
		return value
	},
	boolean(value, label) {
		if (value !== undefined && typeof value !== 'boolean') throw badRequest(`${label} must be true or false`)
		return value
	},
	integer(value, label, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, required = false } = {}) {
		if (value === undefined) {
			if (required) throw badRequest(`${label} is required`)
			return undefined
		}
		if (!Number.isInteger(value) || value < min || value > max) {
			throw badRequest(`${label} must be a whole number from ${min} to ${max}`)
		}
		return value
	}
}
