import { createError } from 'h3'

// Zone, record, rule, view and cluster IDs and Turnstile sitekeys are letters, digits, `_`
// and `-`. Checking before an ID is put into a Cloudflare path gives the page a 400 it can
// show, rather than cfFetch's generic "Invalid API path" or a request to a different path.
export const CLOUDFLARE_ID = /^[A-Za-z0-9_-]{1,64}$/

export const isCloudflareId = (value) => typeof value === 'string' && CLOUDFLARE_ID.test(value)

// Returns the trimmed ID, or throws a 400 naming the field.
export const readId = (value, label) => {
	const id = typeof value === 'string' ? value.trim() : ''
	if (!id) throw createError({ statusCode: 400, statusMessage: `${label} is required` })
	if (!CLOUDFLARE_ID.test(id)) {
		throw createError({ statusCode: 400, statusMessage: `${label} isn't a valid Cloudflare ID` })
	}
	return id
}
