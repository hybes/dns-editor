import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { TOKEN_REJECTED_CODES } from '#shared/utils/cloudflare'
import { cfFetch } from '../utils/cfFetch'

// Checks a token before the browser saves it. User-owned tokens answer
// /user/tokens/verify; account-owned tokens can't, so listing one zone is the fallback,
// and it also proves the token can see zones, which every page needs.

// Codes for a token Cloudflare doesn't recognise: the malformed, unknown or revoked codes
// every request can return, plus two that only mean that here: /user/tokens/verify's
// "Invalid API Token" (1000) and missing authentication headers (9106).
const UNRECOGNISED_CODES = new Set([...TOKEN_REJECTED_CODES, 1000, 9106])
// A recognised token without permission for the request.
const FORBIDDEN_CODE = 10000
// A Global API Key is 37 hex characters and only works with an email header, not as a bearer token.
const GLOBAL_API_KEY = /^[0-9a-f]{37}$/i
// Anything else would be rejected as a header value before reaching Cloudflare.
const PRINTABLE = /^[\x21-\x7e]+$/

const errorCodes = (response) =>
	(response?.errors || [])
		.flatMap((error) => [error?.code, ...(error?.error_chain || []).map((link) => link?.code)])
		.filter(Number.isInteger)

const firstMessage = (response) => response?.errors?.[0]?.message || ''

const isDate = (value) => Boolean(value) && !Number.isNaN(Date.parse(value))

const formatDate = (value) =>
	new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

const rejected = (reason, message) => ({ success: false, reason, result: null, errors: [{ message }], messages: [] })

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)
		const token = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''

		if (!token) {
			throw createError({ statusCode: 400, statusMessage: 'Paste your Cloudflare API token.' })
		}
		if (token.length > 512 || !PRINTABLE.test(token)) {
			throw createError({
				statusCode: 400,
				statusMessage: 'That isn’t a Cloudflare API token, which has no spaces or line breaks. Copy it again.'
			})
		}
		if (GLOBAL_API_KEY.test(token)) {
			return rejected(
				'global_key',
				'This looks like a Global API Key, which DNS Manager can’t use. Create an API token instead.'
			)
		}

		// Never cached: the answer decides whether the browser keeps the token.
		const get = async (path) => {
			try {
				return await cfFetch({ apiKey: token, method: 'GET', path })
			} catch {
				return null
			}
		}

		const verify = await get('/user/tokens/verify')
		const details = verify?.success ? verify.result || {} : null
		const now = Date.now()

		if (details) {
			const expired = isDate(details.expires_on) && Date.parse(details.expires_on) <= now
			if (details.status === 'expired' || expired) {
				const when = isDate(details.expires_on) ? ` on ${formatDate(details.expires_on)}` : ''
				return rejected(
					'expired',
					`This token expired${when}. Create a new token, or change its expiry in Cloudflare.`
				)
			}
			if (details.status === 'disabled') {
				return rejected(
					'disabled',
					'This token is disabled in Cloudflare. Enable it again, or create a new token.'
				)
			}
			if (isDate(details.not_before) && Date.parse(details.not_before) > now) {
				return rejected(
					'not_yet_valid',
					`This token only works from ${formatDate(details.not_before)}. Try again then, or create a token without a start date.`
				)
			}
		}

		const zones = await get('/zones?per_page=1')
		if (zones?.success) {
			return {
				success: true,
				result: {
					status: 'active',
					owner: details ? 'user' : 'account',
					expires_on: details?.expires_on || null
				},
				errors: [],
				messages: []
			}
		}

		if (!zones) {
			return rejected(
				'unreachable',
				'Couldn’t reach Cloudflare from this server. Check its internet connection, then try again.'
			)
		}

		// Timeouts and HTTP failures arrive without a Cloudflare error code.
		const codes = errorCodes(zones)
		const message = firstMessage(zones)
		if (!codes.length) {
			return rejected(
				'unreachable',
				/try again/i.test(message)
					? `Couldn’t check the token. ${message}`
					: `Couldn’t check the token. Cloudflare answered “${message || 'no response'}”. Try again in a moment.`
			)
		}

		const unrecognised = codes.some((code) => UNRECOGNISED_CODES.has(code))
		if (details || (codes.includes(FORBIDDEN_CODE) && !unrecognised)) {
			return rejected(
				'permission',
				'Cloudflare accepted this token, but it can’t list zones. Give it Zone: Read for the zones you manage, then try again.'
			)
		}
		if (unrecognised) {
			return rejected(
				'invalid',
				'Cloudflare doesn’t recognise this token. Check you copied all of it, or create a new one.'
			)
		}
		return rejected('rejected', `Cloudflare rejected this token: ${message}`)
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			statusMessage: error?.message || 'Unknown error'
		})
	}
})
