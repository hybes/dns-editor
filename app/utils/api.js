import { MISSING_PERMISSION_CODES, R2_NOT_ENABLED_CODE } from '#shared/utils/cloudflare'

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
	// The server's own sentence is in `message`; `statusMessage` is only the HTTP reason phrase.
	if (error.data?.message) return error.data.message
	if (error.data?.statusMessage) return error.data.statusMessage
	if (error.name === 'FetchError' && !error.response) {
		if (/timeout|timed out/i.test(`${error.message} ${error.cause?.name || ''}`)) {
			return 'The DNS Manager server didn’t answer in time. Try again.'
		}
		return 'Couldn’t reach the DNS Manager server. Check your connection and try again.'
	}
	return error.message || error.statusMessage || fallback
}

// Server routes answer 400 when the submitted input is invalid, which belongs next to
// the field rather than in a toast.
export const isInputError = (error) => (error?.statusCode ?? error?.data?.statusCode) === 400

const errorsOf = (error) => error?.response?.errors || error?.data?.errors || []

// Cloudflare's answer when the token is valid but lacks a permission.
export const isPermissionError = (error) =>
	errorsOf(error).some(
		(item) =>
			MISSING_PERMISSION_CODES.has(item?.code) ||
			/\b(authentication error|not authori[sz]ed)\b/i.test(item?.message || '')
	)

export const isR2NotEnabled = (error) =>
	errorsOf(error).some((item) => item?.code === R2_NOT_ENABLED_CODE || /\benable R2\b/i.test(item?.message || ''))
