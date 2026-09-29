import { endSession } from '../../utils/session'

// Signs out this browser.
export default defineEventHandler((event) => {
	endSession(event)
	return { success: true, errors: [], messages: [], result: null }
})
