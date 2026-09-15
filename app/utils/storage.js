// Central registry of the localStorage keys the app uses, so the strings live in one
// place instead of being repeated across pages.
export const STORAGE_KEYS = {
	apiKey: 'cf-api-key',
	zoneId: 'cf-zone-id',
	dnsLookupRecent: 'cf-dns-lookup-recent',
	domainSearchTlds: 'cf-domain-search-tlds',
	recordsHiddenColumns: 'dns-records-hidden-columns'
}

// Keys written by earlier versions of the app, removed on logout so nothing lingers.
const LEGACY_KEYS = [
	'cf-zone-name',
	'cf-dns-id',
	'cf-dns-name',
	'cf-account-id',
	'cf-account-name',
	'zones-view-mode',
	'cf-recent-zones'
]

// Keys cleared on logout. Presets, hidden columns and chosen domain endings are
// preferences, so they stay.
export const SESSION_KEYS = [STORAGE_KEYS.apiKey, STORAGE_KEYS.zoneId, STORAGE_KEYS.dnsLookupRecent, ...LEGACY_KEYS]

export const PRESET_PREFIX = 'cf-dns-preset-'

export const presetKey = (name) => `${PRESET_PREFIX}${name}`

export const readStorage = (key, fallback = '') => {
	if (import.meta.server) return fallback
	return localStorage.getItem(key) ?? fallback
}
