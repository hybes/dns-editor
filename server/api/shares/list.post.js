import { memberShares, ownedShares } from '../../utils/shares'

// The shares this account has made (with each person's domains and levels) and the ones others
// have made with it.
export default defineEventHandler((event) => {
	const userId = event.context.user.id
	return {
		success: true,
		errors: [],
		messages: [],
		result: { owned: ownedShares(userId), received: memberShares(userId) }
	}
})
