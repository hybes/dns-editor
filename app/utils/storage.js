// Central registry of the localStorage keys the app uses, so the 'cf-*' strings
// live in one place instead of being repeated across every page.
export const STORAGE_KEYS = {
	apiKey: 'cf-api-key',
	zoneId: 'cf-zone-id',
	zoneName: 'cf-zone-name',
	dnsId: 'cf-dns-id',
	dnsName: 'cf-dns-name',
	accountId: 'cf-account-id',
	accountName: 'cf-account-name',
	zonesViewMode: 'zones-view-mode',
	recentZones: 'cf-recent-zones',
	dnsLookupRecent: 'cf-dns-lookup-recent',
	domainSearchTlds: 'cf-domain-search-tlds'
}

// Keys cleared on logout (everything that is not a per-record preset).
export const SESSION_KEYS = [
	STORAGE_KEYS.apiKey,
	STORAGE_KEYS.zoneId,
	STORAGE_KEYS.zoneName,
	STORAGE_KEYS.dnsId,
	STORAGE_KEYS.dnsName,
	STORAGE_KEYS.accountId,
	STORAGE_KEYS.accountName,
	STORAGE_KEYS.zonesViewMode,
	STORAGE_KEYS.recentZones,
	STORAGE_KEYS.dnsLookupRecent
]

export const PRESET_PREFIX = 'cf-dns-preset-'

export const recordsUpdatedKey = (zoneId) => `cf-records-updated-${zoneId}`
export const presetKey = (name) => `${PRESET_PREFIX}${name}`

export const readStorage = (key, fallback = '') => {
	if (import.meta.server) return fallback
	return localStorage.getItem(key) ?? fallback
}
