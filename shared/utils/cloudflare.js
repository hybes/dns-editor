// Cloudflare facts that the pages and the server routes both rely on.

export const API_TOKENS_URL = 'https://dash.cloudflare.com/profile/api-tokens'

// Every permission DNS Manager's pages use, named as Cloudflare's token form shows them (its API
// calls Edit "Write"). The sign-in page's link fills in the ones with a `template` key, the only
// keys Cloudflare's template link documents, and lists the rest to add by hand; the automatic
// set-up (server/api/token_setup.post.js) asks for all of them. tokenSetup.js maps the dashboard
// labels that differ from their API names.
// https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/
export const APP_PERMISSIONS = [
	{ scope: 'zone', name: 'Zone', access: 'Read', use: 'Listing zones', template: 'zone' },
	{ scope: 'zone', name: 'DNS', access: 'Edit', use: 'Records, DNSSEC, DNS settings', template: 'dns' },
	{ scope: 'zone', name: 'Zone Settings', access: 'Edit', use: 'SSL mode, zone settings', template: 'zone_settings' },
	{ scope: 'zone', name: 'Analytics', access: 'Read', use: 'Analytics', template: 'analytics' },
	{ scope: 'zone', name: 'Zone WAF', access: 'Edit', use: 'Rules: custom, rate limiting and managed rules' },
	...[
		'Single Redirect',
		'Origin Rules',
		'Config Rules',
		'Transform Rules',
		'Cache Rules',
		'Custom Error Rules',
		'Response Compression'
	].map((name) => ({ scope: 'zone', name, access: 'Edit', use: 'Rules: the other sections' })),
	{ scope: 'zone', name: 'Bot Management', access: 'Edit', use: 'Bot Fight Mode' },
	{
		scope: 'account',
		name: 'Account Settings',
		access: 'Edit',
		use: 'Accounts, transfer peers',
		template: 'account_settings'
	},
	{ scope: 'account', name: 'Account Analytics', access: 'Read', use: 'Analytics', template: 'account_analytics' },
	{ scope: 'account', name: 'Workers R2 Storage', access: 'Edit', use: 'Files', template: 'workers_r2' },
	{ scope: 'account', name: 'Billing', access: 'Read', use: 'Usage and billing', template: 'billing' },
	{ scope: 'account', name: 'Turnstile', access: 'Edit', use: 'Turnstile' },
	{ scope: 'account', name: 'DNS Firewall', access: 'Edit', use: 'DNS Firewall' },
	// https://developers.cloudflare.com/dns/internal-dns/dns-views/
	{ scope: 'account', name: 'DNS Views', access: 'Edit', use: 'DNS Views' },
	{
		scope: 'account',
		name: 'Registrar',
		access: 'Edit',
		use: 'Registrar and its prices in Domain Search'
	}
]

// The permissions Cloudflare's token template link can fill in.
export const TOKEN_TEMPLATE_PERMISSIONS = APP_PERMISSIONS.filter((item) => item.template).map((item) => ({
	...item,
	key: item.template,
	type: item.access.toLowerCase()
}))

// Opens Cloudflare's Create Token form with the permissions above, for all accounts and zones.
export const TOKEN_TEMPLATE_URL = `${API_TOKENS_URL}?permissionGroupKeys=${encodeURIComponent(
	JSON.stringify(TOKEN_TEMPLATE_PERMISSIONS.map(({ key, type }) => ({ key, type })))
)}&accountId=%2A&zoneId=all&name=${encodeURIComponent('DNS Manager')}`

// Opens Cloudflare's token form with the one permission DNS Manager's automatic set-up needs,
// User API Tokens Edit, as Cloudflare's Create Additional Tokens template has it. Cloudflare
// documents `account_api_tokens` for the account permission but no key for the user one;
// `api_tokens` follows the same naming. The form drops a key it doesn't know, so the sign-in page
// also says how to add the permission by hand.
export const TOKEN_SETUP_URL = `${API_TOKENS_URL}?permissionGroupKeys=${encodeURIComponent(
	JSON.stringify([{ key: 'api_tokens', type: 'edit' }])
)}&accountId=%2A&zoneId=all&name=${encodeURIComponent('DNS Manager set-up')}`

// Error codes for a malformed or unusable token on ordinary API calls. Missing permissions use
// other codes (see below) and are handled by the page that asked.
export const TOKEN_REJECTED_CODES = new Set([6003, 6111])

// A valid token without the permission a request needs: 10000 ("Authentication error") and 9109
// ("Unauthorized to access requested resource") from the REST API, "authz" from GraphQL.
export const MISSING_PERMISSION_CODES = new Set([10000, 9109, 'authz'])

// R2 answers 10042 ("Please enable R2 through the Cloudflare Dashboard") until it's turned on.
export const R2_NOT_ENABLED_CODE = 10042
