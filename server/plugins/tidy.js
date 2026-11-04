import { log, logText, msSince } from '../../shared/utils/log'
import { useDb } from '../utils/db'
import { tidyExpired } from '../utils/shares'

// Opens the database at start-up, so a problem with the data directory shows at once, then
// clears expired sessions and invites every hour.
const HOUR_MS = 60 * 60 * 1000

function tidy() {
	const started = performance.now()
	try {
		const { sessions, invites } = tidyExpired()
		if (sessions || invites) {
			log.info('tidy', logText`cleared ${sessions} expired sessions and ${invites} expired invites`, {
				runtime: 'cron',
				sessions,
				invites,
				durationMs: msSince(started)
			})
		}
	} catch (error) {
		log.error('tidy', logText`couldn’t clear expired sessions and invites: ${error?.message}`, {
			runtime: 'cron',
			durationMs: msSince(started),
			error
		})
	}
}

export default defineNitroPlugin(() => {
	try {
		useDb()
	} catch (error) {
		log.error('startup', logText`couldn’t open the database: ${error?.message}`, {
			dataDir: useRuntimeConfig().dataDir,
			error
		})
		throw error
	}
	tidy()
	const timer = setInterval(tidy, HOUR_MS)
	timer.unref?.()
})
