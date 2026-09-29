import { useDb } from '../utils/db'
import { tidyExpired } from '../utils/shares'

// Opens the database at start-up, so a problem with the data directory shows at once, then
// clears expired sessions and invites every hour.
const HOUR_MS = 60 * 60 * 1000

export default defineNitroPlugin(() => {
	useDb()
	tidyExpired()
	const timer = setInterval(() => {
		try {
			tidyExpired()
		} catch (error) {
			console.error('[dns-manager] Couldn’t clear expired sessions and invites:', error?.message)
		}
	}, HOUR_MS)
	timer.unref?.()
})
