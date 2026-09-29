import { useDb } from '../utils/db'

// For container and load-balancer health checks: the server is up and its database answers.
export default defineEventHandler(() => {
	useDb().prepare('select 1').get()
	return { ok: true }
})
