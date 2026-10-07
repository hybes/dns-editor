import { bucketNameForZone } from '../../app/utils/zoneBucket'
import { useDb } from './db'

export const bucketForZone = (zoneId, accountId) =>
	useDb().prepare('select bucket_name from zone_buckets where zone_id = ? and account_id = ?').get(zoneId, accountId)
		?.bucket_name || bucketNameForZone(zoneId)

export const withZoneBucket = (zone) => ({
	...zone,
	filesBucket: bucketForZone(zone.id, zone.account?.id || '')
})
