import { cfCommand } from './cfCommand'
import { listZones } from './cfLists'
import { connectionsWithTokens, tokenFor } from './connections'
import { sharedZones } from './shares'
import { allows } from '#shared/utils/access'

// Renewal dates, auto-renew and prices for the Zones list, for the account's own zones and for
// zones shared with it.
// - Own zones: every Cloudflare Registrar registration in the accounts the zones belong to,
//   priced by `registrar registrations check`: the domain's own quote where Cloudflare gives one,
//   otherwise Cloudflare's current price for a new, standard name on the same ending
//   (`standard: true`), which is what a standard name renews at.
// - Shared zones: only with Renewals access, read with the owner's connection. The price shown is
//   the owner's own price for that domain if they set one (`custom: true`), else Cloudflare's
//   price if the owner chose to show prices, else none.

const CACHE_MS = 5 * 60_000
const CHECK_BATCH = 20
const PER_PAGE = 100
const MAX_PAGES = 50
const CURRENCY = /^[A-Z]{3}$/

const cache = globalThis.__dnsManagerRenewals || new Map()
if (!globalThis.__dnsManagerRenewals) globalThis.__dnsManagerRenewals = cache

const quote = (item) =>
	CURRENCY.test(item?.pricing?.currency || '') && Number.isFinite(Number(item?.pricing?.renewal_cost))
		? { amount: item.pricing.renewal_cost, currency: item.pricing.currency }
		: null

// "shop.co.uk" → "co.uk"
const endingOf = (domain) => domain.split('.').slice(1).join('.')

const isPermissionRefusal = (response) => (response?.errors || []).some((error) => [10000, 9109].includes(error?.code))

async function listRegistrations(token, account) {
	const items = []
	let cursor = ''
	for (let page = 0; page < MAX_PAGES; page++) {
		const response = await cfCommand({
			apiKey: token,
			command: 'registrar registrations list',
			account,
			flags: { 'per-page': PER_PAGE, ...(cursor && { cursor }) }
		})
		if (!response?.success) return { denied: isPermissionRefusal(response), items }
		items.push(...(response.result || []).filter((item) => item?.domain_name))
		cursor = response.result_info?.cursor || ''
		if (!cursor) break
	}
	return { denied: false, items }
}

// Cloudflare's renewal price per domain: its own quote, or a made-up name on the same ending
// for the standard price.
async function priceDomains(token, account, domains) {
	const probe = `dnsmanager-price-${Date.now().toString(36)}`
	const endings = [...new Set(domains.map(endingOf).filter(Boolean))]
	const names = [...domains, ...endings.map((ending) => `${probe}.${ending}`)]
	const exact = {}
	const standard = {}
	for (let index = 0; index < names.length; index += CHECK_BATCH) {
		const response = await cfCommand({
			apiKey: token,
			command: 'registrar registrations check',
			account,
			body: { domains: names.slice(index, index + CHECK_BATCH) }
		}).catch(() => null)
		for (const item of response?.result?.domains || []) {
			const price = quote(item)
			const name = String(item?.name || '').toLowerCase()
			if (!price || !name) continue
			if (name.startsWith(`${probe}.`)) {
				if (item.registrable === true && item.tier === 'standard') standard[endingOf(name)] = price
			} else exact[name] = { ...price, standard: false }
		}
	}
	const prices = {}
	for (const domain of domains) {
		const price = exact[domain] || (standard[endingOf(domain)] && { ...standard[endingOf(domain)], standard: true })
		if (price) prices[domain] = price
	}
	return prices
}

async function ownRenewals(userId) {
	const registrations = {}
	const prices = {}
	let accounts = 0
	let denied = 0
	for (const connection of connectionsWithTokens(userId)) {
		const zones = await listZones(connection.token)
		const accountIds = [
			...new Set((zones?.success ? zones.result : []).map((zone) => zone.account?.id).filter(Boolean))
		]
		for (const account of accountIds) {
			accounts++
			const { denied: refused, items } = await listRegistrations(connection.token, account)
			if (refused) denied++
			const domains = []
			for (const item of items) {
				const domain = item.domain_name.toLowerCase()
				if (registrations[domain]) continue
				registrations[domain] = { ...item, account, editable: true }
				domains.push(domain)
			}
			if (domains.length) Object.assign(prices, await priceDomains(connection.token, account, domains))
		}
	}
	return { registrations, prices, denied: accounts > 0 && denied === accounts }
}

async function sharedRenewals(userId, own) {
	const registrations = {}
	const prices = {}
	for (const item of sharedZones(userId)) {
		const domain = item.zoneName.toLowerCase()
		if (own.has(domain) || !allows(item.levels.renewals, 'view')) continue
		try {
			const { token } = await tokenFor(item.ownerId, { zone: item.zoneId })
			const response = await cfCommand({
				apiKey: token,
				command: 'registrar registrations get',
				accountOfZone: item.zoneId,
				args: { 'domain-name': item.zoneName }
			})
			if (!response?.success || !response.result?.domain_name) continue
			const zone = await cfCommand({ apiKey: token, command: 'zones get', zone: item.zoneId, cacheTtl: 60_000 })
			const account = zone?.result?.account?.id || ''
			registrations[domain] = {
				...response.result,
				account,
				shared: true,
				editable: allows(item.levels.renewals, 'edit')
			}
			if (item.price) prices[domain] = { ...item.price, custom: true }
			else if (item.showPrices && account) Object.assign(prices, await priceDomains(token, account, [domain]))
		} catch {
			// Left out: the owner's connection couldn't read it.
		}
	}
	return { registrations, prices }
}

// Resolves to { registrations: { domain: registration }, prices: { domain: { amount, currency,
// standard?, custom? } }, denied } for the Zones list. Cached per account for CACHE_MS.
export async function renewalsFor(userId, { fresh = false } = {}) {
	const cached = cache.get(userId)
	if (!fresh && cached && cached.expiresAt > Date.now()) return cached.value
	const own = await ownRenewals(userId)
	const shared = await sharedRenewals(userId, new Set(Object.keys(own.registrations)))
	const value = {
		registrations: { ...own.registrations, ...shared.registrations },
		prices: { ...own.prices, ...shared.prices },
		denied: own.denied
	}
	cache.set(userId, { value, expiresAt: Date.now() + CACHE_MS })
	return value
}

// After an auto-renew change or a share changing, for everyone, since an owner's change shows
// in the lists of the people they share with.
export const forgetRenewals = () => cache.clear()
