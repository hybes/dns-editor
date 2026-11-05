import { createError } from 'h3'
import { log, logText, msSince } from '../../shared/utils/log'
import { capEndpoint, capSiteKey, MAX_CAP_TOKEN_LENGTH } from '../../shared/utils/cap'
import { clientIp } from './rateLimit'

// Confirms the Cap token a sign-in or sign-up form sent (see shared/utils/cap.js), before the
// route does any real work. Call it once per submission: siteverify uses the token up.
//
//   const cap = await checkCap(event, body.capToken, 'sign-up')
//   // cap.verified is false when the check couldn't run; the request carries on regardless.
//
// - A missing, used, expired or made-up token gets a 400 the form shows next to the widget.
// - If Cap can't be reached (timeout, network error or a 5xx), the request goes through
//   unverified, so nobody is locked out while it's down; the rate limits still apply. One
//   warning per outage, with a count of the requests let through.
// - If the server's own settings are wrong (no NUXT_CAP_SECRET_KEY, or Cap refuses the secret),
//   that's our fault rather than the visitor's: the request goes through unverified and it's
//   logged as an error, once per ten minutes.
// - Cap is off, and nothing is checked, when NUXT_PUBLIC_CAP_SITE_KEY is set to empty.

const TIMEOUT_MS = 5000
// Cap's answer when the site key or secret is wrong for a well-formed token.
const BAD_SECRET = /invalid site key or secret/i

const refuse = () =>
	createError({
		statusCode: 400,
		message: 'We couldn’t confirm you’re a person. Run the check again, then try once more.',
		data: { reason: 'cap' }
	})

const hostOf = (url) => {
	try {
		return new URL(url).host
	} catch {
		return url
	}
}

// For the route's own log line, so a sign-in or sign-up that skipped the check says so.
export const unverifiedNote = (cap) =>
	cap.verified || cap.reason === 'off'
		? ''
		: ` (not checked by Cap: ${cap.reason === 'unreachable' ? 'Cap unreachable' : 'Cap settings wrong'})`

export async function checkCap(event, token, form) {
	const config = useRuntimeConfig(event)
	const siteKey = capSiteKey(config.public)
	if (!siteKey) return { verified: false, reason: 'off' }

	const endpoint = capEndpoint(config.public)
	const host = hostOf(endpoint)
	const ip = clientIp(event)
	const secret = typeof config.capSecretKey === 'string' ? config.capSecretKey.trim() : ''
	if (!secret) {
		log.error('cap', logText`NUXT_CAP_SECRET_KEY isn’t set, so a ${form} went through without a Cap check`, {
			form,
			host,
			siteKey,
			once: 'no-secret'
		})
		return { verified: false, reason: 'config' }
	}

	// A missing token is still sent to siteverify, which refuses it: that one call also tells a
	// bot with no token apart from a person whose widget couldn't reach Cap during an outage.
	const response = typeof token === 'string' ? token.trim().slice(0, MAX_CAP_TOKEN_LENGTH) : ''
	const started = performance.now()
	let status
	let result
	let failure
	try {
		const answer = await fetch(`${endpoint}siteverify`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ secret, response }),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		})
		status = answer.status
		result = await answer.json().catch(() => null)
	} catch (error) {
		failure = error
	}
	if (failure || status >= 500 || !result || typeof result !== 'object') {
		const why =
			failure?.name === 'TimeoutError'
				? `no answer in ${TIMEOUT_MS} ms`
				: failure
					? logText`${failure.cause?.code || failure.message}`
					: status >= 500
						? `siteverify answered ${status}`
						: `siteverify answered ${status} without JSON`
		log.warn('cap', logText`couldn’t reach ${host} (${why}); letting a ${form} through unverified`, {
			form,
			host,
			'http.status_code': status,
			durationMs: msSince(started),
			error: failure,
			once: 'outage'
		})
		return { verified: false, reason: 'unreachable' }
	}

	if (result.success === true) return { verified: true }

	const durationMs = msSince(started)
	const capError = typeof result.error === 'string' ? result.error.slice(0, 200) : ''
	// Cap checks the token's site key before the secret, so this answer to a token made for our
	// site key means the server's secret (or site key) is wrong, not the visitor.
	if (BAD_SECRET.test(capError) && response.startsWith(`${siteKey}:`)) {
		log.error(
			'cap',
			logText`${host} refused NUXT_CAP_SECRET_KEY for site key ${siteKey} (${status}: ${capError}); letting a ${form} through unverified`,
			{ form, host, siteKey, 'http.status_code': status, capError, durationMs, once: 'bad-secret' }
		)
		return { verified: false, reason: 'config' }
	}

	// Expected for bots and for someone who submits twice; once per address per ten minutes.
	log.info(
		'cap',
		logText`refused a ${form} from ${ip}: ${response ? capError || `Cap answered ${status}` : 'no token'}`,
		{
			form,
			ip,
			host,
			'http.status_code': status,
			capError,
			hadToken: Boolean(response),
			durationMs,
			once: `refused:${ip}`
		}
	)
	throw refuse()
}
