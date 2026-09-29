// The R2 bucket that holds a zone's files: the zone name with dots as hyphens, so example.com
// uses the bucket example-com. R2 bucket names are 3 to 63 lower-case letters, digits and
// hyphens, starting and ending with a letter or digit; a longer name is shortened and ends with
// a short hash of the full name, so two long zones never share a bucket.

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

export const bucketNameForZone = (zoneName) => {
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
