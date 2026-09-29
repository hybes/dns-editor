import { domainToASCII } from 'node:url'
import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { buildCfRequest, cfCommand, cfCommandPath, requireCfCommand, sendCfRequest } from '../utils/cfCommand'
import { invalidateCfCache } from '../utils/cfFetch'
import { normaliseSearchTerm } from '../utils/domainNames'
import { readId } from '../utils/ids'

// Registers a domain with Cloudflare Registrar. It's the one billable action in the app, so it
// has its own route instead of going through /api/cf/run, and it follows cf's own
// `registrar registrations create`: the page shows a quote from `registrar registrations check`
// and the person confirms it; this route checks again immediately before submitting and
// refuses if the domain is no longer registrable or the price differs from the quote. It
// submits once and never retries, because a registration charges the account's default
// payment method and can't be refunded.
//
// Body: { apiKey, account, domain, body, quote: { currency, registration_cost, renewal_cost, years } }
//   body   the registration request, shaped by the extension's registration schema
//   quote  the price the person confirmed; renewal_cost is needed for terms over a year
// Answers with Cloudflare's envelope for the create. Its result is the registration workflow's
// status, and a workflow that is still in progress counts as a success.

const MAX_YEARS = 10
const CURRENCY = /^[A-Z]{3}$/
const AMOUNT = /^\d{1,12}(?:\.\d{1,8})?$/

const REASONS = {
	domain_unavailable: (domain) => `${domain} is no longer available to register.`,
	domain_premium: (domain) => `${domain} is a premium name, which Cloudflare’s API can’t register.`,
	extension_not_supported: (domain) => `Cloudflare Registrar doesn’t sell ${domain}’s ending.`,
	extension_not_supported_via_api: (domain) =>
		`Cloudflare Registrar can only register ${domain} in the Cloudflare dashboard, not through its API.`,
	extension_disallows_registration: (domain) =>
		`The registry for ${domain}’s ending isn’t accepting new registrations at the moment.`
}

const badRequest = (statusMessage) => createError({ statusCode: 400, message: statusMessage })

// `check` is Cloudflare's current answer for the domain, so the page can show what changed.
const conflict = (statusMessage, check) => createError({ statusCode: 409, message: statusMessage, data: { check } })

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// A registrable name as Cloudflare checks it: lower-case, no trailing dot, punycode for
// international names. Pasted URLs are refused rather than trimmed down to a host.
const readDomain = (value) => {
	const raw = typeof value === 'string' ? value.trim().toLowerCase().replace(/\.$/, '') : ''
	if (!raw) throw badRequest('Domain is required')
	const ascii = domainToASCII(raw)
	const term = normaliseSearchTerm(raw)
	if (term.error) throw badRequest(term.error)
	if (!ascii || term.name !== ascii || !term.tld) {
		throw badRequest(`“${raw}” isn’t a domain name. Use the full name, such as example.com`)
	}
	return ascii
}

const readAmount = (value, label) => {
	const text = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
	if (!AMOUNT.test(text)) throw badRequest(`${label} must be an amount such as 10.44`)
	return text
}

const readQuote = (value) => {
	if (!isObject(value)) throw badRequest('Quote is required: the price you confirmed')
	const currency = typeof value.currency === 'string' ? value.currency.trim() : ''
	if (!CURRENCY.test(currency)) throw badRequest('Quote currency must be a three-letter code such as USD')
	const years = value.years
	if (!Number.isInteger(years) || years < 1 || years > MAX_YEARS) {
		throw badRequest(`Quote years must be a whole number from 1 to ${MAX_YEARS}`)
	}
	const quote = { currency, years, registration_cost: readAmount(value.registration_cost, 'Quote registration cost') }
	// Every year after the first is charged at the renewal price, so a longer term needs it.
	if (value.renewal_cost !== undefined || years > 1) {
		quote.renewal_cost = readAmount(value.renewal_cost, 'Quote renewal cost')
	}
	return quote
}

const readRegistration = (value, domain, quote) => {
	if (!isObject(value)) throw badRequest('The registration request must be a JSON object')
	if (value.domain_name !== undefined) {
		const named = typeof value.domain_name === 'string' ? domainToASCII(value.domain_name.trim().toLowerCase()) : ''
		if (named.replace(/\.$/, '') !== domain) {
			throw badRequest(`The registration request is for ${value.domain_name}, not ${domain}`)
		}
	}
	if (value.years !== undefined && value.years !== quote.years) {
		throw badRequest(
			`The registration request asks for ${value.years} years, but the quote you confirmed is for ${quote.years}`
		)
	}
	if (value.auto_renew !== undefined && typeof value.auto_renew !== 'boolean') {
		throw badRequest('auto_renew must be true or false')
	}
	return value
}

// 10.4 and 10.40 are the same price.
const sameAmount = (a, b) => {
	const tidy = (text) => {
		const [whole, fraction = ''] = String(text ?? '').split('.')
		const cleanFraction = fraction.replace(/0+$/, '')
		const cleanWhole = whole.replace(/^0+(?=\d)/, '')
		return cleanFraction ? `${cleanWhole}.${cleanFraction}` : cleanWhole
	}
	return tidy(a) === tidy(b)
}

const priceChanged = (pricing, quote) =>
	pricing.currency !== quote.currency ||
	!sameAmount(pricing.registration_cost, quote.registration_cost) ||
	(quote.renewal_cost !== undefined && !sameAmount(pricing.renewal_cost, quote.renewal_cost))

// The re-check, as cf's requireRegistrationAvailability makes it. Returns the checked entry or
// throws a 409 that says what changed.
const requireRegistrable = (entries, domain, quote) => {
	const matches = (Array.isArray(entries) ? entries : []).filter(
		(entry) => typeof entry?.name === 'string' && entry.name.toLowerCase() === domain
	)
	if (matches.length !== 1) {
		throw conflict(
			`Cloudflare’s availability check didn’t return one clear result for ${domain}, so it wasn’t registered.`
		)
	}
	const [checked] = matches
	if (checked.registrable !== true) {
		const reason = REASONS[checked.reason]
		throw conflict(
			reason
				? `${reason(domain)} Nothing was registered.`
				: `Cloudflare can no longer register ${domain}${checked.reason ? ` (${checked.reason})` : ''}. Nothing was registered.`,
			checked
		)
	}
	if (checked.tier !== 'standard') {
		throw conflict(
			`${domain} isn’t a standard-priced name, which is all Cloudflare’s API can register. Nothing was registered.`,
			checked
		)
	}
	const pricing = checked.pricing
	if (!pricing || !CURRENCY.test(pricing.currency || '') || !AMOUNT.test(String(pricing.registration_cost ?? ''))) {
		throw conflict(`Cloudflare didn’t return a usable price for ${domain}, so it wasn’t registered.`, checked)
	}
	if (priceChanged(pricing, quote)) {
		throw conflict(
			`The price for ${domain} has changed since you confirmed it, so it wasn’t registered. Review the new price and confirm again.`,
			checked
		)
	}
	return checked
}

// Cloudflare's own errors carry a code. One without, such as a timeout or a bare HTTP 5xx,
// means the answer was lost, not that the registration was refused.
const isUncertain = (envelope) =>
	envelope?.success === false && !(envelope.errors || []).some((error) => Number.isInteger(error?.code))

const UNCERTAIN_ADVICE = 'The registration may still have gone through, so check its status before trying again.'

export default defineEventHandler(async (event) => {
	try {
		const input = await readJsonBody(event)
		const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : ''
		if (!apiKey) throw badRequest('API key is required')
		const account = readId(input.account, 'Account ID')
		const domain = readDomain(input.domain)
		const quote = readQuote(input.quote)
		const registration = readRegistration(input.body, domain, quote)

		// Availability and price can change between the quote and now, so check again right
		// before submitting. A failed check comes back as Cloudflare's envelope, and nothing is sent.
		const check = await cfCommand({
			apiKey,
			command: 'registrar registrations check',
			account,
			body: { domains: [domain] }
		})
		if (!check?.success) return check
		// Throws a 409 when the domain can't be registered any more or the price has moved.
		requireRegistrable(check.result?.domains, domain, quote)

		// `Prefer: respond-async` makes Cloudflare answer straight away with the workflow's
		// status (202) instead of holding the connection, which could outlast this server's
		// request timeout and leave the outcome unknown. The page polls the status instead.
		const command = await requireCfCommand('registrar registrations create')
		const request = await buildCfRequest(command, {
			apiKey,
			account,
			body: { ...registration, domain_name: domain, years: quote.years }
		})
		request.headers = { ...request.headers, Prefer: 'respond-async' }

		let created
		try {
			created = await sendCfRequest(apiKey, command, request)
		} catch (error) {
			throw createError({
				statusCode: 502,
				message: `Couldn’t confirm whether Cloudflare received the registration (${error?.message || 'network error'}). ${UNCERTAIN_ADVICE}`,
				data: { uncertain: true }
			})
		}

		if (created?.success) {
			const path = await cfCommandPath('registrar registrations list', { account })
			invalidateCfCache({ apiKey, paths: [path] })
			return created
		}
		if (isUncertain(created)) {
			// cfFetch's timeout message ends "Try again", which is the wrong advice here.
			const detail = (created.errors?.[0]?.message || '').replace(/\s*Try again\.?\s*$/, '').replace(/\.$/, '')
			const message = `Cloudflare didn’t confirm the registration${detail ? ` (${detail})` : ''}. ${UNCERTAIN_ADVICE}`
			return { ...created, uncertain: true, errors: [{ message }] }
		}
		return created
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: error?.message || 'Unknown error'
		})
	}
})
