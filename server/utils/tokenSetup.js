import { APP_PERMISSIONS } from '#shared/utils/cloudflare'

// Turns APP_PERMISSIONS into Cloudflare's permission groups, as `cf user tokens
// permission-groups list` names them today, and into the policies of a token for every account
// and zone the person can reach. Groups are matched by name rather than by ID, since IDs aren't
// documented and names are what the token form shows.

const SCOPES = { zone: 'com.cloudflare.api.account.zone', account: 'com.cloudflare.api.account' }

// The dashboard labels differ from the permission-groups API for these products.
const API_NAMES = {
	'Single Redirect': 'dynamic url redirects',
	'Origin Rules': 'origin',
	'Config Rules': 'config settings',
	'Transform Rules': 'zone transform rules',
	'Cache Rules': 'cache settings',
	'Custom Error Rules': 'custom errors'
}

// "DNS Write" → { family: 'dns', access: 'edit' }. The API says Write where the form says Edit.
const splitName = (name) => {
	const match = /^(.*\S)\s+(Read|Write|Edit)$/i.exec(String(name || '').trim())
	if (!match) return null
	return { family: match[1].toLowerCase(), access: match[2].toLowerCase() === 'read' ? 'read' : 'edit' }
}

const fits = (wanted, group, parts) =>
	[wanted.name.toLowerCase(), API_NAMES[wanted.name]].includes(parts.family) &&
	(group.scopes || []).includes(SCOPES[wanted.scope])

// Resolves to { picked: [{ id, name, scope, use }], missing: [{ name, access, use }] }. An Edit
// permission Cloudflare only offers as Read is taken as Read and listed in `missing` too.
export const pickAppPermissionGroups = (groups) => {
	const named = (Array.isArray(groups) ? groups : [])
		.filter((group) => typeof group?.id === 'string' && typeof group?.name === 'string')
		.map((group) => ({ group, parts: splitName(group.name) }))
		.filter(({ parts }) => parts)

	const picked = new Map()
	const missing = []
	for (const wanted of APP_PERMISSIONS) {
		const candidates = named.filter(({ group, parts }) => fits(wanted, group, parts))
		const access = wanted.access.toLowerCase()
		const exact = candidates.filter(({ parts }) => parts.access === access)
		const fallback = access === 'edit' ? candidates.filter(({ parts }) => parts.access === 'read') : []
		const chosen = exact.length ? exact : fallback
		for (const { group } of chosen) {
			if (!picked.has(group.id)) {
				picked.set(group.id, { id: group.id, name: group.name, scope: wanted.scope, use: wanted.use })
			}
		}
		if (!exact.length) missing.push({ name: wanted.name, access: wanted.access, use: wanted.use })
	}
	return { picked: [...picked.values()], missing }
}

// Every account and zone permission Cloudflare offers, for a token that can run any Console
// command: the Edit (Write) group of each permission, or its Read group where there's no Edit,
// plus groups such as Purge or Revoke. User permissions (API tokens, memberships) are left out,
// and so are Account API Tokens and Access service tokens: Cloudflare refuses a token made by
// another token that can manage tokens ("sub-token is not allowed to have permissions to manage
// other tokens").
const MANAGES_TOKENS = /\b(?:API|Service) Tokens?\b/i
export const pickAllPermissionGroups = (groups) => {
	const usable = (Array.isArray(groups) ? groups : [])
		.filter((group) => typeof group?.id === 'string' && typeof group?.name === 'string')
		.map((group) => {
			const scopes = group.scopes || []
			const scope = scopes.includes(SCOPES.zone) ? 'zone' : scopes.includes(SCOPES.account) ? 'account' : ''
			return { group, scope, parts: splitName(group.name) }
		})
		.filter(({ group, scope }) => scope && !MANAGES_TOKENS.test(group.name))
	const editable = new Set(
		usable.filter(({ parts }) => parts?.access === 'edit').map(({ scope, parts }) => `${scope}|${parts.family}`)
	)
	return usable
		.filter(({ scope, parts }) => parts?.access !== 'read' || !editable.has(`${scope}|${parts.family}`))
		.map(({ group, scope }) => ({ id: group.id, name: group.name, scope, use: '' }))
}

// One policy for the zone permissions on every zone, one for the account permissions on every
// account, as Cloudflare's docs write them.
// https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/
export const appTokenPolicies = (picked) =>
	Object.entries(SCOPES)
		.map(([scope, resource]) => ({
			effect: 'allow',
			resources: { [`${resource}.*`]: '*' },
			permission_groups: picked.filter((group) => group.scope === scope).map(({ id }) => ({ id }))
		}))
		.filter((policy) => policy.permission_groups.length)
