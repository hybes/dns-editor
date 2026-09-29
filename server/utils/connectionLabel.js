import { listAccounts, listZones } from './cfLists'

// A name for a new connection from the Cloudflare accounts its token can see, such as
// "Ben Hybert" or "Ben Hybert and 2 more". The person can rename it.
export async function connectionLabel(token) {
	const [accounts, zones] = await Promise.all([listAccounts(token), listZones(token)])
	const names = new Map()
	for (const account of accounts?.success ? accounts.result : []) names.set(account.id, account.name)
	for (const zone of zones?.success ? zones.result : []) {
		if (zone.account?.id && !names.has(zone.account.id)) names.set(zone.account.id, zone.account.name)
	}
	const list = [...names.values()].filter(Boolean).sort((a, b) => a.localeCompare(b))
	if (!list.length) return 'Cloudflare'
	return list.length === 1 ? list[0] : `${list[0]} and ${list.length - 1} more`
}
