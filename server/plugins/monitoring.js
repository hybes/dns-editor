import { getRequestHeader } from 'h3'
import { capSiteKey } from '../../shared/utils/cap'
import { log, logText, logValue } from '../../shared/utils/log'

// Start-up checks and one log line for each failed API request. Uncaught errors still become
// GlitchTip issues through the Sentry module; these lines put them in the log feed with the
// route, the account and the reason.

// Validation failures on the sign-in pages are people mistyping, not bugs.
const QUIET_PATHS = /^\/api\/auth\//

function checkConfig() {
	const config = useRuntimeConfig()
	const facts = {
		dataDir: config.dataDir,
		node: process.version,
		aiEditor: Boolean(config.openaiApiKey),
		aiModel: config.openaiDnsModel,
		cap: !capSiteKey(config.public) ? 'off' : config.capSecretKey ? 'on' : 'no secret'
	}
	if (!config.tokenKey) {
		log.warn(
			'startup',
			logText`NUXT_TOKEN_KEY isn’t set, so Cloudflare tokens are encrypted with token.key in ${config.dataDir}`,
			facts
		)
	} else if (Buffer.from(config.tokenKey, 'base64').length !== 32) {
		log.error('startup', 'NUXT_TOKEN_KEY isn’t 32 bytes of base64; saved connections can’t be read', {
			...facts,
			tokenKeyBytes: Buffer.from(config.tokenKey, 'base64').length
		})
	}
	if (facts.cap === 'no secret') {
		log.error(
			'startup',
			'NUXT_CAP_SECRET_KEY isn’t set, so sign-ins and sign-ups go through without a Cap check',
			facts
		)
	}
	log.info(
		'startup',
		logText`server started on ${process.version} (data in ${config.dataDir}, AI editor ${facts.aiEditor ? 'on' : 'off'}, Cap ${facts.cap})`,
		facts
	)
}

export default defineNitroPlugin((nitroApp) => {
	try {
		checkConfig()
	} catch (error) {
		log.error('startup', logText`config check failed: ${error?.message}`, { error })
	}

	nitroApp.hooks.hook('error', (error, { event } = {}) => {
		try {
			const status = Number(error?.statusCode ?? error?.status ?? 500)
			const path = String(event?.path || '').split('?')[0]
			const method = event?.method || ''
			if (status < 500 && (status !== 400 || QUIET_PATHS.test(path))) return
			const user = event?.context?.user
			const message = logValue(error?.message || 'Unknown error')
			const facts = {
				method,
				path,
				'http.status_code': status,
				route: path,
				userId: user?.id,
				username: user?.username,
				connectionId: event?.context?.connectionId,
				shared: event?.context?.access?.shared || undefined,
				userAgent: event ? getRequestHeader(event, 'user-agent') : undefined,
				reason: error?.data?.reason,
				// A 4xx is the app refusing input on purpose; its stack says nothing.
				error: status >= 500 ? (error?.cause instanceof Error ? error.cause : error) : undefined
			}
			const who = user ? ` for ${user.username}` : ''
			// The same failure on the same route is one line a minute, with a count.
			const repeat = { once: `${method} ${path} ${status} ${message.slice(0, 120)}`, windowMs: 60_000 }
			// Another service failing on its side (marked by the route) is logged at info, with a rare warning.
			if (status >= 500 && error?.data?.upstreamOutage)
				log.outage('api', logText`${method} ${path} failed ${status}${who}: ${message}`, {
					...facts,
					...repeat
				})
			else if (status >= 500)
				log.error('api', logText`${method} ${path} failed ${status}${who}: ${message}`, { ...facts, ...repeat })
			else
				log.warn('api', logText`${method} ${path} rejected ${status}${who}: ${message}`, {
					...facts,
					...repeat
				})
		} catch {
			// Never let logging turn one error into two.
		}
	})
})
