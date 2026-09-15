import { TOKEN_REJECTED_CODES } from '#shared/utils/cloudflare'

const isTokenRejected = (response) =>
	(response?.errors || []).some(
		(error) =>
			TOKEN_REJECTED_CODES.has(error?.code) ||
			(error?.error_chain || []).some((link) => TOKEN_REJECTED_CODES.has(link?.code))
	)

// Calls this app's /api proxies with the stored Cloudflare token and throws on the
// success:false envelope, so callers need a single try/catch for every failure.
// Pass { auth: false } for the tools routes, which never need the token.
export function useCfApi() {
	const { getApiKey } = useSession()
	const toast = useToast()

	const call = async (endpoint, body = {}, { fallback, auth = true } = {}) => {
		const response = await $fetch(`/api/${endpoint}`, {
			method: 'POST',
			body: auth ? { apiKey: getApiKey(), ...body } : body
		})
		if (response && response.success === false) {
			if (auth && isTokenRejected(response)) {
				toast.add({
					id: 'cf-token-rejected',
					title: 'Cloudflare rejected the saved token',
					description: 'It may have expired or been revoked. Replace it to keep working.',
					icon: 'i-lucide-key-round',
					color: 'error',
					duration: 0,
					actions: [{ label: 'Replace token', color: 'neutral', variant: 'outline', to: '/login?replace=1' }]
				})
			}
			throw new CfApiError(cfErrorMessage(response, fallback), response)
		}
		return response
	}

	return { call }
}
