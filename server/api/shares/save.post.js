import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { ownZoneNames } from '../../utils/connections'
import { createShare, readShareZones, updateShare } from '../../utils/shares'
import { forgetRenewals } from '../../utils/renewals'

// Creates a share, or updates one when `id` is given. Body: { id?, label, defaults: { area:
// level }, showPrices, zones: [{ id, overrides?: { area: level }, price?: { amount, currency } }] }.
// Only zones this account's own connections can see can be shared. A new share answers with the
// invite link's token; the link is /invite/<token>.
export default defineEventHandler(async (event) => {
	const userId = event.context.user.id
	const body = await readJsonBody(event)
	const label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) : ''
	if (!label) throw createError({ statusCode: 400, message: 'Enter a name for the person you’re sharing with.' })
	const zones = readShareZones(body.zones, await ownZoneNames(userId))
	if (!zones.length) throw createError({ statusCode: 400, message: 'Choose at least one domain to share.' })
	const share = { label, defaults: body.defaults, showPrices: body.showPrices === true, zones }
	if (body.id) {
		updateShare(userId, Number(body.id), share)
		forgetRenewals()
		return { success: true, errors: [], messages: [], result: { id: Number(body.id) } }
	}
	const { id, inviteToken } = createShare(userId, share)
	forgetRenewals()
	return { success: true, errors: [], messages: [], result: { id, inviteToken } }
})
