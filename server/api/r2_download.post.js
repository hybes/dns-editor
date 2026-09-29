import { createError, getRequestHeader, setResponseHeaders, setResponseStatus } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfFetchRaw } from '../utils/cfFetch'
import { readId } from '../utils/ids'
import { buildObjectRequest, findZoneBucket, readObjectKey, TRANSFER_TIMEOUT_MS } from '../utils/r2Files'

// Downloads one file from the zone's R2 bucket with `r2 objects get`.
// Body: { apiKey, currZone, key }. Answers with the file's bytes as an attachment, or with
// Cloudflare's envelope and an error status when Cloudflare doesn't return it.

// Cloudflare's codes for a missing bucket or object: https://developers.cloudflare.com/r2/api/error-codes/
const NOT_FOUND_CODES = new Set([10006, 10007])

const fileName = (key) => key.split('/').filter(Boolean).pop() || 'download'

// RFC 6266: an ASCII-only name for old clients, then the exact name encoded as UTF-8.
const contentDisposition = (name) => {
	const fallback = name.replace(/[^\x20-\x7e]|["\\%]/g, '_')
	const encoded = encodeURIComponent(name).replace(
		/['()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
	)
	return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

const failure = (event, envelope) => {
	const errors = envelope?.errors?.length ? envelope.errors : [{ message: 'Cloudflare didn’t return the file' }]
	setResponseStatus(event, errors.some((item) => NOT_FOUND_CODES.has(item?.code)) ? 404 : 502)
	return { success: false, errors, messages: envelope?.messages || [], result: null }
}

export default defineEventHandler(async (event) => {
	try {
		// JSON only. A form on another site can't send JSON without the browser asking first, so
		// it can't use this route to make the app's own address serve a file.
		if (!/^application\/json\b/i.test(getRequestHeader(event, 'content-type') || '')) {
			throw createError({ statusCode: 415, message: 'Send the request as JSON' })
		}
		const body = await readJsonBody(event)
		const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
		if (!apiKey) throw createError({ statusCode: 400, message: 'API key is required' })
		const zoneId = readId(body.currZone, 'Zone ID')
		const key = readObjectKey(body.key)

		const target = await findZoneBucket(apiKey, zoneId)
		if (target.error) return failure(event, target.error)

		const { request } = await buildObjectRequest('r2 objects get', {
			apiKey,
			accountId: target.accountId,
			bucket: target.bucket,
			key
		})
		const raw = await cfFetchRaw({
			apiKey,
			method: request.method,
			path: request.path,
			query: request.query,
			headers: request.headers,
			as: 'buffer',
			timeout: TRANSFER_TIMEOUT_MS
		})
		if (!raw.success) return failure(event, raw)

		// Always a download, never shown in the app's own origin, whatever type the file claims.
		setResponseHeaders(event, {
			'Content-Type': raw.contentType || 'application/octet-stream',
			'Content-Length': String(raw.buffer.length),
			'Content-Disposition': contentDisposition(fileName(key)),
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'; sandbox"
		})
		return raw.buffer
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: `Couldn’t download the file: ${error?.message || 'unknown error'}`
		})
	}
})
