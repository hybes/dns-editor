import { createError } from 'h3'
import { bucketForZone } from './zoneBuckets'
import { buildCfRequest, cfCommand, requireCfCommand } from './cfCommand'

// The pieces the Files page's upload and download routes share. Those routes move a file's
// bytes, which /api/cf/run can't carry, so they look up the zone's bucket themselves.

const ZONE_LOOKUP_TTL_MS = 60_000
// A file of up to 100 MB can take longer than the usual 20 seconds to reach or leave R2.
export const TRANSFER_TIMEOUT_MS = 5 * 60_000
// R2's limit on key length: https://developers.cloudflare.com/r2/platform/limits/
const MAX_KEY_BYTES = 1024
const CONTROL_CHARACTER = /\p{Cc}/u

const badRequest = (statusMessage) => createError({ statusCode: 400, message: statusMessage })

// An object key as the Files page builds it: a folder prefix and a file name. Returns the key
// unchanged, or throws a 400 that says what's wrong with it.
export const readObjectKey = (value) => {
	const key = typeof value === 'string' ? value : ''
	if (!key) throw badRequest('Object key is required')
	if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
		throw badRequest(`Object keys can be at most ${MAX_KEY_BYTES} bytes`)
	}
	if (CONTROL_CHARACTER.test(key)) throw badRequest('Object keys can’t contain control characters')
	// A URL reads a folder called . or .. as a step in the path, and the Files page never makes
	// empty folders, so keys like these would reach R2 as a different key or not at all.
	const parts = key.split('/')
	if (key.startsWith('/') || key.includes('//') || parts.includes('.') || parts.includes('..')) {
		throw badRequest('Object keys can’t start with /, contain // or have a folder called “.” or “..”')
	}
	return key
}

// The zone's account and the bucket named after it, by the rule in app/utils/zoneBucket.js.
// Resolves to { bucket, accountId, zoneName }, or { error } with Cloudflare's envelope.
export async function findZoneBucket(apiKey, zoneId, access) {
	if (access?.shared && zoneId !== access.zoneId) {
		throw createError({ statusCode: 403, message: 'That domain isn’t shared with you.' })
	}
	const zone = await cfCommand({ apiKey, command: 'zones get', zone: zoneId, cacheTtl: ZONE_LOOKUP_TTL_MS })
	if (!zone?.success) return { error: zone }
	const accountId = zone.result?.account?.id || ''
	const bucket = bucketForZone(zoneId, accountId)
	if (!accountId || !bucket) {
		return {
			error: {
				success: false,
				errors: [{ message: 'Cloudflare didn’t say which account owns this zone' }],
				messages: [],
				result: null
			}
		}
	}
	return { bucket, accountId, zoneName: zone.result.name }
}

// Builds an `r2 objects` request for one key in the zone's bucket. The key's slashes stay as
// they are (docs/report.pdf, not docs%2Freport.pdf), as the catalogue marks R2 object keys.
// Resolves to { command, request } for sendCfRequest or cfFetchRaw.
export async function buildObjectRequest(name, { apiKey, accountId, bucket, key, flags, body }) {
	const command = await requireCfCommand(name)
	const request = await buildCfRequest(command, {
		apiKey,
		account: accountId,
		args: { 'object-key': key },
		flags: { ...flags, 'bucket-name': bucket },
		body
	})
	return { command, request }
}
