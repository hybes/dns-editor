import { cfCommand } from './cfCommand'

// Every zone and every account one token can see, page by page. Shared by the zones and
// accounts routes, which add up all of a user's Cloudflare connections, and by connections.js,
// which works out which connection to use for a zone or account.

// 50 is the most Cloudflare returns per page of zones and of accounts.
const PER_PAGE = 50
const ZONES_TTL = 30_000
const ACCOUNTS_TTL = 60_000
const MAX_ACCOUNT_PAGES = 20
// Large accounts list quickly without a burst of requests against Cloudflare's rate limit.
const CONCURRENCY = 4

const noResponse = (page) => ({
	success: false,
	errors: [{ message: `Cloudflare returned nothing for page ${page} of the zone list. Try again.` }]
})

// Resolves to { success: true, result: [zones] } or Cloudflare's failure envelope.
export async function listZones(apiKey, { fresh = false } = {}) {
	const fetchPage = (page) =>
		cfCommand({
			apiKey,
			command: 'zones list',
			flags: { page, 'per-page': PER_PAGE },
			cacheTtl: ZONES_TTL,
			fresh
		})

	const first = await fetchPage(1)
	if (!first?.success) return first || noResponse(1)

	const totalPages = Math.max(1, Number(first.result_info?.total_pages) || 1)
	const remaining = Array.from({ length: totalPages - 1 }, (_, index) => index + 2)
	const pages = []
	let next = 0
	let failure = null

	// A list with a page missing would hide zones without saying so, so one failed page fails
	// the whole list and no further pages are started.
	const worker = async () => {
		while (!failure && next < remaining.length) {
			const index = next++
			const page = remaining[index]
			const data = await fetchPage(page)
			if (data?.success) pages[index] = data.result || []
			else failure ||= data || noResponse(page)
		}
	}
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, remaining.length) }, worker))
	if (failure) return failure

	// A zone added or removed mid-listing shifts page boundaries, which can repeat a zone.
	const byId = new Map()
	for (const zone of [first.result || [], ...pages].flat()) {
		if (zone?.id) byId.set(zone.id, zone)
	}
	return { success: true, errors: [], messages: [], result: [...byId.values()] }
}

// Resolves to { success: true, result: [{ id, name, type }] } or Cloudflare's failure envelope.
export async function listAccounts(apiKey, { fresh = false } = {}) {
	const accounts = new Map()
	for (let page = 1; page <= MAX_ACCOUNT_PAGES; page++) {
		const data = await cfCommand({
			apiKey,
			command: 'accounts list',
			flags: { page, 'per-page': PER_PAGE },
			cacheTtl: ACCOUNTS_TTL,
			fresh
		})
		// A missing page would hide accounts without saying so, so it fails the whole list.
		if (!data?.success) return data
		for (const account of data.result || []) {
			if (account?.id) accounts.set(account.id, { id: account.id, name: account.name || '', type: account.type })
		}
		if (page >= (Number(data.result_info?.total_pages) || 1)) break
	}
	return { success: true, errors: [], messages: [], result: [...accounts.values()] }
}
