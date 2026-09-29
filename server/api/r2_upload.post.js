import { createError, getQuery, getRequestHeader, readRawBody } from 'h3'
import { sendCfRequest } from '../utils/cfCommand'
import { readId } from '../utils/ids'
import { buildObjectRequest, findZoneBucket, readObjectKey, TRANSFER_TIMEOUT_MS } from '../utils/r2Files'

// Uploads one file to the zone's R2 bucket with `r2 objects put`. The body is the file's
// bytes, so everything else comes in the query, and the token from the signed-in account's
// connection for the zone (server/middleware/auth.js):
//   POST /api/r2_upload?zone=<zone ID>&key=<object key>&type=<content type>
// The bucket is always the one named after the zone, never one the browser names. Answers
// with Cloudflare's envelope.

// Cloudflare's REST API takes uploads of up to 300 MB:
// https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/upload/
// This route holds the whole file in memory, so it stops at 100 MB. The Files page (app/pages/zones/[zone_id]/files.vue) checks the same limit.
const MAX_UPLOAD_BYTES = 100_000_000

// The type goes to Cloudflare as a header, so only type/subtype with optional parameters.
const CONTENT_TYPE = /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:\s*;[\x20-\x7e]*)?$/
const DEFAULT_TYPE = 'application/octet-stream'

const badRequest = (statusMessage) => createError({ statusCode: 400, message: statusMessage })
const tooLarge = () => createError({ statusCode: 413, message: 'Files can be at most 100 MB each when uploaded here' })
const queryText = (value) => (typeof value === 'string' ? value : '')

export default defineEventHandler(async (event) => {
	try {
		const apiKey = event.context.cfToken
		if (!apiKey) throw badRequest('Add a Cloudflare connection first')

		const query = getQuery(event)
		const zoneId = readId(queryText(query.zone), 'Zone ID')
		const key = readObjectKey(queryText(query.key))
		const type = queryText(query.type).trim() || DEFAULT_TYPE
		if (type.length > 255 || !CONTENT_TYPE.test(type)) throw badRequest('That isn’t a content type R2 accepts')

		// Checked before reading, so an oversized file is refused without holding it in memory.
		const length = Number.parseInt(getRequestHeader(event, 'content-length') || '', 10)
		if (!Number.isFinite(length) || length < 0) {
			throw createError({ statusCode: 411, message: 'Send the file with its length (Content-Length)' })
		}
		if (length > MAX_UPLOAD_BYTES) throw tooLarge()
		// An empty file arrives as no body at all.
		const body = (await readRawBody(event, false)) || Buffer.alloc(0)
		if (body.length > MAX_UPLOAD_BYTES) throw tooLarge()

		const target = await findZoneBucket(apiKey, zoneId)
		if (target.error) return target.error

		const { command, request } = await buildObjectRequest('r2 objects put', {
			apiKey,
			accountId: target.accountId,
			bucket: target.bucket,
			key,
			flags: { 'content-type': type },
			body
		})
		return await sendCfRequest(apiKey, command, request, { timeout: TRANSFER_TIMEOUT_MS })
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: `Couldn’t upload the file: ${error?.message || 'unknown error'}`
		})
	}
})
