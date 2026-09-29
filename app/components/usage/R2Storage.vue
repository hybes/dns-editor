<template>
	<UsageSection
		v-if="!blocked"
		title="R2 storage"
		:loading="list.loading || metrics.loading"
		:error="metrics.denied ? '' : metrics.error"
		error-title="Couldn’t load R2 metrics"
		@retry="loadMetrics"
	>
		<template #description>
			<p>
				Each bucket’s stored size and objects, and its Class A and Class B operations in the period, from
				Cloudflare’s R2 metrics. Buckets that hold a zone’s files link to its Files page.
			</p>
		</template>

		<UAlert
			v-if="list.error && !list.denied && !list.off"
			color="error"
			variant="subtle"
			icon="i-lucide-circle-alert"
			role="alert"
			title="Couldn’t list the account’s R2 buckets"
			:actions="[
				{
					label: 'Try again',
					icon: 'i-lucide-refresh-cw',
					color: 'neutral',
					variant: 'outline',
					loading: list.loading,
					onClick: loadList
				}
			]"
		>
			<template #description>
				<p>Cloudflare said: {{ list.error }}</p>
				<p class="mt-1">Buckets with metrics still show below.</p>
			</template>
		</UAlert>

		<UAlert
			v-if="metrics.notice"
			color="warning"
			variant="subtle"
			icon="i-lucide-calendar-x"
			title="No R2 metrics for this period"
			:description="metrics.notice"
		/>

		<UTable
			v-if="rows.length || !settled || !bothFailed"
			:data="rows"
			:columns="columns"
			:loading="!settled || list.loading || metrics.loading"
			:caption="`R2 buckets with their storage and operations${periodLabel ? `, ${periodLabel}` : ''}`"
			:ui="{ th: 'px-3 py-2', td: 'px-3 py-2', tfoot: 'bg-elevated/30' }"
		>
			<template #loading>
				<div class="flex flex-col gap-3" role="status">
					<span class="sr-only">Loading R2 buckets…</span>
					<USkeleton v-for="row in 4" :key="row" class="h-6 w-full" />
				</div>
			</template>

			<template #empty>
				<UEmpty
					v-if="settled"
					variant="naked"
					icon="i-lucide-hard-drive"
					title="No R2 buckets in this account"
					:description="emptyDescription"
				/>
			</template>

			<template #name-cell="{ row }">
				<div class="flex max-w-[50vw] min-w-0 flex-col gap-0.5 sm:max-w-80">
					<span v-if="row.original.accountWide" class="text-muted">Not on a bucket</span>
					<span v-else class="text-highlighted truncate font-mono font-medium">{{ row.original.name }}</span>
					<ULink
						v-if="row.original.zone"
						:to="`/zones/${row.original.zone.id}/files`"
						class="text-primary truncate text-xs hover:underline"
					>
						Files for {{ row.original.zone.name }}
					</ULink>
					<span v-if="row.original.details" class="text-muted truncate text-xs">
						{{ row.original.details }}
					</span>
				</div>
			</template>

			<template #stored-cell="{ row }">
				<span v-if="row.original.hasStorage" class="tabular-nums">{{ formatBytes(row.original.stored) }}</span>
				<span v-else-if="metrics.result && !row.original.accountWide" class="text-dimmed">No data</span>
				<!-- An empty slot would fall back to the raw value. -->
				<span v-else />
			</template>

			<template #objectCount-cell="{ row }">
				<span v-if="row.original.hasStorage" class="tabular-nums">
					{{ formatNumber(row.original.objectCount) }}
				</span>
				<span v-else />
			</template>

			<template #classA-cell="{ row }">
				<span v-if="row.original.hasOperations" class="tabular-nums">
					{{ formatNumber(row.original.classA) }}
				</span>
				<span v-else-if="metrics.result" class="text-dimmed">0</span>
				<span v-else />
			</template>

			<template #classB-cell="{ row }">
				<span v-if="row.original.hasOperations" class="tabular-nums">
					{{ formatNumber(row.original.classB) }}
				</span>
				<span v-else-if="metrics.result" class="text-dimmed">0</span>
				<span v-else />
			</template>
		</UTable>

		<div v-if="metrics.result && rows.length" class="text-dimmed flex flex-col gap-1 text-xs text-pretty">
			<p>
				Stored size and objects are each bucket’s peak on the latest day in the period that Cloudflare has a
				measurement for. R2 bills storage on the average of daily peaks.
			</p>
			<p>
				Operations follow the classes on
				<ULink to="https://developers.cloudflare.com/r2/pricing/" target="_blank" class="underline">
					R2’s pricing page</ULink
				>. Deletes and aborted uploads are free and aren’t counted.
			</p>
			<p v-if="earliestLabel">
				Cloudflare keeps R2 metrics for a limited time, so these figures start on {{ earliestLabel }}.
			</p>
			<p v-if="otherOperations">
				{{ plural(otherOperations, 'operation') }} of other types ({{
					metrics.result.unclassifiedTypes.join(', ') || 'unnamed'
				}}) aren’t in either class.
			</p>
			<p v-if="metrics.result.truncated">
				Cloudflare returned as many groups as it allows, so some older or smaller figures may be missing.
			</p>
		</div>
	</UsageSection>
</template>

<script setup>
// R2 for one account: every bucket `cf r2 buckets list` returns, joined with the storage and
// Class A and B operations /api/r2_usage reads from Cloudflare's GraphQL Analytics API. A bucket
// with no recent metrics still shows, and one that only has metrics (another jurisdiction, or
// deleted during the period) shows too. Buckets named for a zone in this account, as the Files
// page names them, link there.
const props = defineProps({
	account: { type: String, required: true },
	// YYYY-MM-DD, UTC, both days included
	from: { type: String, required: true },
	to: { type: String, required: true },
	periodLabel: { type: String, default: '' },
	refreshKey: { type: Number, default: 0 }
})

// { loading, missing, readable, hidden }, for the page's summary of what the token can't read
const emit = defineEmits(['access'])

// The API's largest page, and a cap so a runaway cursor can't loop for ever.
const PER_PAGE = 1000
const MAX_PAGES = 20

const { exec } = useCfCommands()
const { call } = useCfApi()
const { zones } = useZones()

// `denied` is a missing permission and `off` is R2 not turned on for the account; the page
// explains both once, not in each section.
const list = reactive({ items: [], loading: false, loaded: false, error: '', denied: false, off: false })
// `notice` is this app's own answer about the dates (outside what Cloudflare keeps), which
// isn't a token problem, so it shows apart from Cloudflare's errors.
const metrics = reactive({ result: null, loading: false, loaded: false, error: '', notice: '', denied: false })
let listRequest = 0
let metricsRequest = 0

const settled = computed(() => list.loaded && metrics.loaded)
// Nothing to show: no bucket list, and no metrics to list buckets from either.
const blocked = computed(
	() =>
		(list.denied || list.off) &&
		(metrics.denied || (metrics.loaded && !metrics.error && !metrics.result?.buckets?.length))
)
const bothFailed = computed(() => Boolean(list.error && (metrics.error || metrics.notice)))

const dayFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const earliestLabel = computed(() =>
	metrics.result?.earliest ? dayFormat.format(Date.parse(`${metrics.result.earliest}T00:00:00Z`)) : ''
)

const BYTE_UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB']
const byteFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 })
// Decimal units, as R2's pricing counts gigabytes.
const formatBytes = (bytes) => {
	let value = Number(bytes) || 0
	let unit = 0
	while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
		value /= 1000
		unit++
	}
	return unit === 0 ? plural(value, 'byte') : `${byteFormat.format(value)} ${BYTE_UNITS[unit]}`
}

const LOCATIONS = {
	apac: 'Asia-Pacific',
	eeur: 'Eastern Europe',
	enam: 'Eastern North America',
	weur: 'Western Europe',
	wnam: 'Western North America',
	oc: 'Oceania'
}
const JURISDICTIONS = {
	eu: 'EU jurisdiction',
	fedramp: 'FedRAMP jurisdiction',
	'fedramp-high': 'FedRAMP High jurisdiction'
}

// R2's metrics name a bucket in another jurisdiction with its prefix (eu_my-bucket). Bucket
// names can't contain underscores, so the prefix is unambiguous.
const metricsKey = (bucket) =>
	bucket.jurisdiction && bucket.jurisdiction !== 'default' ? `${bucket.jurisdiction}_${bucket.name}` : bucket.name

const splitKey = (key) => {
	const index = key.indexOf('_')
	return index === -1
		? { name: key, jurisdiction: '' }
		: { name: key.slice(index + 1), jurisdiction: key.slice(0, index) }
}

const zoneBuckets = computed(() => {
	const map = new Map()
	for (const zone of zones.value) {
		if (zone?.account?.id !== props.account) continue
		const bucket = bucketNameForZone(zone.name)
		if (bucket) map.set(bucket, zone)
	}
	return map
})

const rows = computed(() => {
	const byKey = new Map()
	for (const bucket of list.items) {
		if (bucket?.name) byKey.set(metricsKey(bucket), { listed: bucket })
	}
	for (const measured of metrics.result?.buckets || []) {
		if (!measured?.name) continue
		byKey.set(measured.name, { ...byKey.get(measured.name), measured })
	}

	const shaped = [...byKey].map(([key, { listed, measured }]) => {
		const { name, jurisdiction } = listed
			? { name: listed.name, jurisdiction: listed.jurisdiction !== 'default' ? listed.jurisdiction || '' : '' }
			: splitKey(key)
		const details = [
			jurisdiction && (JURISDICTIONS[jurisdiction] || `${jurisdiction} jurisdiction`),
			listed?.location && (LOCATIONS[String(listed.location).toLowerCase()] || listed.location),
			listed?.storage_class === 'InfrequentAccess' && 'New objects use Infrequent Access',
			!listed && !jurisdiction && list.loaded && !list.error && 'Not in the bucket list'
		].filter(Boolean)
		return {
			key,
			name,
			zone: jurisdiction ? null : zoneBuckets.value.get(name) || null,
			details: details.join(' · '),
			hasStorage: Boolean(measured?.storedOn),
			stored: (measured?.payloadSize || 0) + (measured?.metadataSize || 0),
			objectCount: measured?.objectCount || 0,
			hasOperations: Boolean(measured && (measured.classA || measured.classB)),
			classA: measured?.classA || 0,
			classB: measured?.classB || 0
		}
	})

	// A zone's bucket first, then the rest by name.
	shaped.sort((a, b) => Number(Boolean(b.zone)) - Number(Boolean(a.zone)) || a.name.localeCompare(b.name))

	const wide = metrics.result?.accountWide
	if (shaped.length && wide && (wide.classA || wide.classB)) {
		shaped.push({
			key: 'account-wide',
			accountWide: true,
			name: 'Not on a bucket',
			zone: null,
			details: 'Such as listing buckets',
			hasStorage: false,
			stored: 0,
			objectCount: 0,
			hasOperations: true,
			classA: wide.classA,
			classB: wide.classB
		})
	}
	return shaped
})

const otherOperations = computed(() =>
	(metrics.result?.buckets || []).reduce(
		(sum, bucket) => sum + (bucket.other || 0),
		metrics.result?.accountWide?.other || 0
	)
)

const emptyDescription = computed(() =>
	list.error
		? 'Cloudflare reported no R2 metrics for this period.'
		: 'Cloudflare listed no buckets and reported no R2 metrics for this period.'
)

const sum = (field) => rows.value.reduce((total, row) => total + (row[field] || 0), 0)
const figure = (text) => h('span', { class: 'tabular-nums' }, text)

const END = { th: 'text-end', td: 'text-end whitespace-nowrap' }
const FROM_SM_END = { th: 'hidden text-end sm:table-cell', td: 'hidden text-end whitespace-nowrap sm:table-cell' }

// A totals row only once there's more than one row and metrics to add up.
const columns = computed(() => {
	const totals = rows.value.length > 1 && Boolean(metrics.result)
	const withFooter = (column, render) => (totals ? { ...column, footer: render } : column)
	return [
		withFooter({ accessorKey: 'name', header: 'Bucket' }, () => 'Total'),
		withFooter({ accessorKey: 'stored', header: 'Stored', meta: { class: END } }, () =>
			figure(formatBytes(sum('stored')))
		),
		withFooter({ accessorKey: 'objectCount', header: 'Objects', meta: { class: FROM_SM_END } }, () =>
			figure(formatNumber(sum('objectCount')))
		),
		withFooter({ accessorKey: 'classA', header: 'Class A', meta: { class: END } }, () =>
			figure(formatNumber(sum('classA')))
		),
		withFooter({ accessorKey: 'classB', header: 'Class B', meta: { class: END } }, () =>
			figure(formatNumber(sum('classB')))
		)
	]
})

// Every page of buckets, following the cursor, as `cf r2 buckets list` pages them.
const loadList = async () => {
	const account = props.account
	if (!account) return
	const id = ++listRequest
	list.loading = true
	list.error = ''
	try {
		const buckets = []
		let cursor = ''
		for (let page = 0; page < MAX_PAGES; page++) {
			const flags = { 'per-page': PER_PAGE, ...(cursor && { cursor }) }
			const response = await exec(
				'r2 buckets list',
				{ account, flags },
				{ fallback: 'Cloudflare didn’t list the R2 buckets' }
			)
			if (id !== listRequest) return
			buckets.push(...(response?.result?.buckets || []))
			cursor = response?.result_info?.cursor || ''
			if (!cursor) break
		}
		list.items = buckets
		list.denied = false
		list.off = false
	} catch (failure) {
		if (id !== listRequest) return
		list.error = describeError(failure, 'Cloudflare didn’t list the R2 buckets')
		list.off = isR2NotEnabled(failure)
		list.denied = !list.off && isPermissionError(failure)
		list.items = []
	} finally {
		if (id === listRequest) {
			list.loading = false
			list.loaded = true
		}
	}
}

const loadMetrics = async () => {
	const { account, from, to } = props
	if (!account || !from || !to) return
	const id = ++metricsRequest
	metrics.loading = true
	metrics.error = ''
	metrics.notice = ''
	try {
		const response = await call(
			'r2_usage',
			{ account, from, to },
			{ fallback: 'Cloudflare returned no R2 metrics' }
		)
		if (id !== metricsRequest) return
		metrics.result = response?.result || null
		metrics.denied = false
	} catch (failure) {
		if (id !== metricsRequest) return
		const message = describeError(failure, 'Cloudflare returned no R2 metrics')
		if (isInputError(failure)) metrics.notice = message
		else metrics.error = message
		metrics.denied = isPermissionError(failure)
		metrics.result = null
	} finally {
		if (id === metricsRequest) {
			metrics.loading = false
			metrics.loaded = true
		}
	}
}

watch(
	() => props.account,
	() => {
		Object.assign(list, { items: [], loaded: false, error: '', denied: false, off: false })
		Object.assign(metrics, { result: null, loaded: false, error: '', notice: '', denied: false })
	}
)

watch(
	() => ({
		loading: list.loading || metrics.loading,
		missing: [list.off && 'r2-off', list.denied && 'r2', metrics.denied && 'analytics'].filter(Boolean),
		readable: settled.value && !list.error && !metrics.error,
		hidden: blocked.value
	}),
	(access) => emit('access', access),
	{ immediate: true }
)

watch(() => [props.account, props.refreshKey], loadList, { immediate: true })
watch(() => [props.account, props.from, props.to, props.refreshKey], loadMetrics, { immediate: true })
</script>
