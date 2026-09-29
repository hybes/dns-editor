// What a person someone has shared domains with can do on each of them, by area. The owner
// sets a level for each area as the share's default and can override any domain. The server
// enforces it (server/utils/access.js); the pages use it to hide what the level doesn't allow.

export const LEVELS = { none: 0, view: 1, edit: 2, delete: 3 }

export const LEVEL_LABELS = {
	none: 'No access',
	view: 'View',
	edit: 'Edit',
	delete: 'Edit and delete'
}

// `levels` are the choices that make sense for the area, lowest first. `short` is for sentences.
export const AREAS = [
	{ key: 'records', label: 'DNS records', short: 'records', levels: ['none', 'view', 'edit', 'delete'] },
	{ key: 'analytics', label: 'Analytics', short: 'analytics', levels: ['none', 'view'] },
	{
		key: 'dns',
		label: 'DNSSEC, DNS settings and zone transfers',
		short: 'DNS settings',
		levels: ['none', 'view', 'edit', 'delete']
	},
	{
		key: 'settings',
		label: 'Zone settings, SSL/TLS and Bot Fight Mode',
		short: 'zone settings',
		levels: ['none', 'view', 'edit']
	},
	{ key: 'rules', label: 'Rules', short: 'rules', levels: ['none', 'view', 'edit', 'delete'] },
	{ key: 'files', label: 'Files', short: 'files', levels: ['none', 'view', 'edit', 'delete'] },
	{ key: 'renewals', label: 'Renewal date and auto-renew', short: 'renewals', levels: ['none', 'view', 'edit'] }
]

export const AREA_KEYS = AREAS.map((area) => area.key)

// A new share starts by letting the person see records, analytics and renewal dates.
export const DEFAULT_LEVELS = {
	records: 'view',
	analytics: 'view',
	dns: 'none',
	settings: 'none',
	rules: 'none',
	files: 'none',
	renewals: 'view'
}

// A clean set of levels from anything stored or sent: every area, each a level that area offers.
export function cleanLevels(value, fallback = DEFAULT_LEVELS) {
	const source = value && typeof value === 'object' ? value : {}
	return Object.fromEntries(
		AREAS.map((area) => {
			const level = source[area.key]
			return [area.key, area.levels.includes(level) ? level : fallback[area.key] || 'none']
		})
	)
}

// Only the areas that differ from the defaults, for a domain's overrides.
export function cleanOverrides(value) {
	const source = value && typeof value === 'object' ? value : {}
	return Object.fromEntries(
		AREAS.filter((area) => area.levels.includes(source[area.key])).map((area) => [area.key, source[area.key]])
	)
}

export const effectiveLevels = (defaults, overrides) => ({ ...cleanLevels(defaults), ...cleanOverrides(overrides) })

// "edit records · view analytics, files and renewals", for a set of levels.
export function describeLevels(levels) {
	const list = (items) =>
		items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]
	const parts = [
		['delete', 'edit and delete'],
		['edit', 'edit'],
		['view', 'view']
	]
		.map(([level, verb]) => {
			const areas = AREAS.filter((area) => levels?.[area.key] === level).map((area) => area.short)
			return areas.length ? `${verb} ${list(areas)}` : ''
		})
		.filter(Boolean)
	return parts.length ? parts.join(' · ') : 'no access'
}

// Whether `level` allows `action`: view, edit or delete.
export const allows = (level, action) => (LEVELS[level] ?? 0) >= (LEVELS[action] ?? Infinity)
