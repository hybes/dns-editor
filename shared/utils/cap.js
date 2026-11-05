// Cap (https://trycap.dev) checks that sign-ins and sign-ups come from a person's browser. It runs
// on our own Cap Standalone server: the widget solves a small proof-of-work challenge from
// `<endpoint>challenge` and gets a token, and the server confirms that token once at
// `<endpoint>siteverify`. The site key is public; the secret stays on the server.

export const CAP_HOST = 'https://cap.brth.uk'
export const DEFAULT_CAP_SITE_KEY = 'cb61c77ed2'

// Cap Standalone tokens are `<site key>:<id>:<value>`. Anything far longer isn't one.
export const MAX_CAP_TOKEN_LENGTH = 512

const text = (value) => (typeof value === 'string' ? value.trim() : '')

// The site key from the public runtime config. Empty turns Cap off (for self-hosted copies).
export const capSiteKey = (publicConfig) => text(publicConfig?.capSiteKey)

// The widget and siteverify endpoint, ending in a slash: NUXT_PUBLIC_CAP_API_ENDPOINT if set,
// otherwise the site key's endpoint on cap.brth.uk. Empty when Cap is off.
export function capEndpoint(publicConfig) {
	const siteKey = capSiteKey(publicConfig)
	if (!siteKey) return ''
	const custom = text(publicConfig?.capApiEndpoint)
	const endpoint = custom || `${CAP_HOST}/${encodeURIComponent(siteKey)}/`
	return endpoint.endsWith('/') ? endpoint : `${endpoint}/`
}
