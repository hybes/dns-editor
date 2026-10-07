// Zone IDs give every new bucket a unique name, including domains whose names slug alike.
export const bucketNameForZone = (zoneId) => (/^[a-f0-9]{32}$/i.test(zoneId || '') ? `dm-${zoneId.toLowerCase()}` : '')

// Kept only to find older buckets. Owners must link them to one zone before Files uses them.

const MAX_LENGTH = 63
const HASH_LENGTH = 8

// FNV-1a, enough to tell long names apart; not for security.
const shortHash = (text) => {
	let hash = 0x811c9dc5
	for (const char of text) {
		hash ^= char.codePointAt(0)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return hash.toString(36).padStart(HASH_LENGTH, '0').slice(-HASH_LENGTH)
}

export const legacyBucketNameForZone = (zoneName) => {
	const name = String(zoneName || '')
		.trim()
		.toLowerCase()
		.replace(/\.$/, '')
	const slug = name
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
	if (!slug) return ''
	if (slug.length <= MAX_LENGTH) return slug.length >= 3 ? slug : `${slug}-files`
	return `${slug.slice(0, MAX_LENGTH - HASH_LENGTH - 1).replace(/-$/, '')}-${shortHash(name)}`
}

// R2's own rule, for checking a bucket name that comes from anywhere else.
export const R2_BUCKET_NAME = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/
