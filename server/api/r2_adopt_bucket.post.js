import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { readId } from '../utils/ids'
import { cfCommand } from '../utils/cfCommand'
import { useDb } from '../utils/db'
import { bucketNameForZone, legacyBucketNameForZone } from '../../app/utils/zoneBucket'

// This owner-only route changes the local association, never the bucket or its files.
export default defineEventHandler(async (event) => {
	const body = await readJsonBody(event)
	if (event.context.access?.shared)
		throw createError({ statusCode: 403, message: 'Only the owner can link a bucket.' })
	if (body.confirm !== true) {
		throw createError({
			statusCode: 400,
			message: 'Confirm that the older bucket contains only this domain’s files.'
		})
	}
	const zoneId = readId(body.currZone, 'Zone ID')
	const zone = await cfCommand({ apiKey: body.apiKey, command: 'zones get', zone: zoneId })
	if (!zone?.success) return zone
	const account = readId(zone.result?.account?.id, 'Account ID')
	const bucket = legacyBucketNameForZone(zone.result?.name)
	if (!bucket || /^dm-[a-f0-9]{32}$/.test(bucket)) {
		throw createError({ statusCode: 400, message: 'This older bucket name cannot be linked to the domain.' })
	}
	const db = useDb()
	const existing = db
		.prepare('select bucket_name from zone_buckets where zone_id = ? and account_id = ?')
		.get(zoneId, account)
	if (existing?.bucket_name === bucket) return { success: true, result: { bucket } }
	const getBucket = (name) =>
		cfCommand({ apiKey: body.apiKey, command: 'r2 buckets get', account, args: { 'bucket-name': name } })
	const current = await getBucket(bucketNameForZone(zoneId))
	if (current?.success) {
		throw createError({
			statusCode: 409,
			message:
				'This domain already has a new bucket. Keep using it, or move its files in Cloudflare before linking the older bucket.'
		})
	}
	// Only a missing bucket allows the association to change; permission and network errors do not.
	if (!(current?.errors || []).some((error) => error.code === 10006)) return current
	const legacy = await getBucket(bucket)
	if (!legacy?.success) return legacy
	db.prepare(
		'insert into zone_buckets (zone_id, account_id, bucket_name) values (?, ?, ?) on conflict do nothing'
	).run(zoneId, account, bucket)
	const linked = db
		.prepare('select bucket_name from zone_buckets where zone_id = ? and account_id = ?')
		.get(zoneId, account)
	if (linked?.bucket_name !== bucket) {
		throw createError({ statusCode: 409, message: 'That bucket is already linked to another domain.' })
	}
	return { success: true, errors: [], messages: [], result: { bucket } }
})
