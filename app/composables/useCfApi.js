import { TOKEN_REJECTED_CODES } from '#shared/utils/cloudflare'

const isTokenRejected = (response) =>
	(response?.errors || []).some(
		(error) =>
			TOKEN_REJECTED_CODES.has(error?.code) ||
			(error?.error_chain || []).some((link) => TOKEN_REJECTED_CODES.has(link?.code))
	)

// Calls this app's /api routes and throws on the success:false envelope, so callers need a
// single try/catch for every failure. The session cookie goes with every request, and the server
// picks the account's Cloudflare connection; no token is ever sent from here. A session that has
// ended sends the page to sign in, and an account with no connections to add one.
//
// Every call gives up after `timeout` ms, so a request the server never answers (a dropped
// connection, or a restart mid-request) fails with a message instead of loading for ever. The
// server gives Cloudflare 20 seconds per request, and the slowest routes make a few in a row.
const TIMEOUT_MS = 90_000
export function useCfApi() {
	const toast = useToast()
	const session = useAuth()

	const call = async (endpoint, body = {}, { fallback, timeout = TIMEOUT_MS } = {}) => {
		let response
		try {
			response = await $fetch(`/api/${endpoint}`, { method: 'POST', body, timeout })
		} catch (error) {
			const status = error?.statusCode ?? error?.response?.status
			const reason = error?.data?.data?.reason
			if (status === 401 && reason === 'signed_out') {
				session.reset()
				const route = useRoute()
				navigateTo({ path: '/login', query: { redirect: route.fullPath } })
			} else if (status === 409 && reason === 'no_connection') {
				navigateTo('/connections')
			}
			throw error
		}
		if (response && response.success === false) {
			if (isTokenRejected(response)) {
				toast.add({
					id: 'cf-token-rejected',
					title: 'Cloudflare rejected a connection’s token',
					description: 'It may have expired or been revoked. Check your Cloudflare connections.',
					icon: 'i-lucide-key-round',
					color: 'error',
					duration: 0,
					actions: [{ label: 'Open connections', color: 'neutral', variant: 'outline', to: '/connections' }]
				})
			}
			throw new CfApiError(cfErrorMessage(response, fallback), response)
		}
		return response
	}

	return { call }
}
