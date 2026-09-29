import { allows } from '#shared/utils/access'
import { bucketNameForZone } from '../../app/utils/zoneBucket'

// What a request on a shared zone needs: an area and an action (view, edit or delete), checked
// against the levels the owner gave. Anything not listed here is for owners only, so a new route
// or command is closed to shared users until it's added.

// Routes by path. Every shared zone lets the person see its overview.
const ROUTES = {
	'/api/zone': ['overview', 'view'],
	'/api/capabilities': ['overview', 'view'],
	'/api/records': ['records', 'view'],
	'/api/dns_record': ['records', 'view'],
	'/api/export_zone': ['records', 'view'],
	'/api/create_record': ['records', 'edit'],
	'/api/update_record': ['records', 'edit'],
	'/api/patch_record': ['records', 'edit'],
	'/api/import_zone': ['records', 'edit'],
	'/api/ai_dns_editor/plan': ['records', 'edit'],
	'/api/ai_dns_editor/apply': ['records', 'edit'],
	'/api/delete_record': ['records', 'delete'],
	'/api/rulesets': ['rules', 'view'],
	'/api/ruleset': ['rules', 'view'],
	'/api/create_entrypoint': ['rules', 'edit'],
	'/api/create_skip_rule': ['rules', 'edit'],
	'/api/update_rule': ['rules', 'edit'],
	'/api/delete_rule': ['rules', 'delete'],
	'/api/bot_management': ['settings', 'view'],
	'/api/update_ssl': ['settings', 'edit'],
	'/api/update_bot_fight_mode': ['settings', 'edit'],
	'/api/account_analytics': ['analytics', 'view'],
	'/api/r2_download': ['files', 'view'],
	'/api/r2_upload': ['files', 'edit']
}

const actionOf = (method) => (method === 'GET' ? 'view' : method === 'DELETE' ? 'delete' : 'edit')

// cf commands the zone pages run through /api/cf/run, by family. `zoneOnly` commands must act
// on the zone itself, not its account. Files and renewals commands act on the account but are
// tied to the zone: its own bucket, or its own registration.
const COMMANDS = [
	{ match: /^zones get$/, area: 'overview', action: 'view' },
	{ match: /^dns usage account get$/, area: 'records', action: 'view', zoneOnly: true },
	{ match: /^dns records /, area: 'records' },
	{ match: /^dns dnssec /, area: 'dns' },
	{ match: /^dns settings account (get|edit)$/, area: 'dns', zoneOnly: true },
	{ match: /^dns zone-transfers (incoming|outgoing|force-axfr)\b/, area: 'dns' },
	// The zone transfers page names the peers a zone uses, which belong to the account.
	{ match: /^dns zone-transfers peers (list|get)$/, area: 'dns', action: 'view', accountRead: true },
	{ match: /^zones settings /, area: 'settings' },
	{ match: /^bot-management /, area: 'settings' },
	{ match: /^rulesets /, area: 'rules', zoneOnly: true },
	{ match: /^r2 (objects|buckets get$|buckets create$|buckets domains)/, area: 'files', bucket: true },
	{ match: /^registrar registrations (get|get-update-status)$/, area: 'renewals', action: 'view', domain: true },
	{ match: /^registrar registrations update$/, area: 'renewals', action: 'edit', domain: true }
]

const sameName = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()

// [area, action] for a cf command on a shared zone, or null when it isn't allowed.
function commandAccess(command, input, shared) {
	const rule = COMMANDS.find((item) => item.match.test(command.command))
	if (!rule) return null
	const onZone =
		command.scope === 'zone' ||
		(command.scope === 'accountOrZone' && input.target !== 'account' && Boolean(input.zone))
	if (rule.zoneOnly && !onZone) return null
	if (!rule.bucket && !rule.domain && !rule.accountRead && command.scope === 'account') return null
	if (rule.bucket) {
		const values = { ...(input.flags || {}), ...(input.args || {}) }
		const bucket = values['bucket-name'] ?? input.body?.name
		if (!sameName(bucket, bucketNameForZone(shared.zoneName))) return null
		// A custom domain can only be connected on the zone itself.
		if (command.command.includes('domains custom create') && input.body?.zoneId !== shared.zoneId) return null
	}
	if (rule.domain && !sameName(input.args?.['domain-name'], shared.zoneName)) return null
	return [rule.area, rule.action || actionOf(command.method)]
}

// Whether the shared zone's levels allow this request. Resolves to null when allowed, or the
// sentence to refuse it with.
export function refusal({ path, body, command, shared }) {
	const need = path === '/api/cf/run' ? command && commandAccess(command, body || {}, shared) : ROUTES[path]
	if (!need)
		return `${shared.owner} shares ${shared.zoneName} with you, but this isn’t something shared accounts can do.`
	const [area, action] = need
	if (area === 'overview') return null
	if (allows(shared.levels[area], action)) return null
	const verb = action === 'view' ? 'see' : action === 'delete' ? 'delete' : 'change'
	return `${shared.owner} hasn’t given you access to ${verb} this on ${shared.zoneName}.`
}
