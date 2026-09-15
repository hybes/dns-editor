// Turns API failures into sentences a person can act on. The /api proxies return
// Cloudflare's own envelope, where most failures arrive as HTTP 200 with
// success:false and a list of errors rather than as an HTTP error.

export class CfApiError extends Error {
	constructor(message, response) {
		super(message)
		this.name = 'CfApiError'
		this.response = response
	}
}

export const cfErrorMessage = (response, fallback = 'Cloudflare rejected the request') =>
	response?.errors?.[0]?.message || fallback

export const describeError = (error, fallback = 'Something went wrong') => {
	if (!error) return fallback
	if (typeof error === 'string') return error
	if (error.data?.statusMessage) return error.data.statusMessage
	if (error.data?.message) return error.data.message
	if (error.name === 'FetchError' && !error.response) {
		return 'Couldn’t reach the DNS Manager server. Check your connection and try again.'
	}
	return error.statusMessage || error.message || fallback
}

// Server routes answer 400 when the submitted input is invalid, which belongs next to
// the field rather than in a toast.
export const isInputError = (error) => (error?.statusCode ?? error?.data?.statusCode) === 400
