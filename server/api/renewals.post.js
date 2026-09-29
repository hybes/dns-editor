import { readJsonBody } from '../utils/readJsonBody'
import { renewalsFor } from '../utils/renewals'

// Renewal dates, auto-renew and prices for the Zones list (see server/utils/renewals.js).
// Body: { fresh? }.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	const result = await renewalsFor(event.context.user.id, { fresh: body.fresh === true })
	return { success: true, errors: [], messages: [], result }
})
