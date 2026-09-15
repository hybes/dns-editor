// Cloudflare's zone statuses and setup types, shared by the zones list and Overview so the
// same zone never shows two different labels or colours.

export const ZONE_STATUSES = {
	active: { label: 'Active', color: 'success' },
	pending: { label: 'Pending', color: 'warning' },
	initializing: { label: 'Initialising', color: 'warning' },
	moved: { label: 'Moved', color: 'error' },
	deactivated: { label: 'Deactivated', color: 'error' },
	deleted: { label: 'Deleted', color: 'error' },
	'read only': { label: 'Read only', color: 'neutral' }
}

// Anything Cloudflare adds later shows as-is in a neutral badge.
export const zoneStatusBadge = (status) => ZONE_STATUSES[status] || { label: status || 'Unknown', color: 'neutral' }

// `short` suits a list column (empty for the usual full setup); `long` suits Overview.
export const SETUP_LABELS = {
	full: { short: '', long: 'Full (Cloudflare is the authoritative DNS)' },
	partial: { short: 'Partial setup', long: 'Partial (CNAME setup)' },
	secondary: { short: 'Secondary DNS', long: 'Secondary DNS' },
	internal: { short: 'Internal', long: 'Internal' }
}
