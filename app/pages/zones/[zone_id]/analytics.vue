<template>
	<UDashboardPanel id="zone-analytics">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
				<template #title>
					<span>Analytics</span>
					<span v-if="zoneName" class="text-muted hidden truncate font-normal sm:inline">
						· {{ zoneName }}
					</span>
				</template>
				<template #right>
					<UButton
						v-if="canAnalytics"
						label="Refresh"
						icon="i-lucide-refresh-cw"
						color="neutral"
						variant="outline"
						:loading="loading"
						@click="run({ fresh: true })"
					/>
				</template>
			</UDashboardNavbar>

			<UDashboardToolbar
				v-if="canAnalytics"
				:ui="{ root: 'flex-wrap items-start justify-start gap-x-4 gap-y-3 overflow-visible py-3' }"
			>
				<UFieldGroup size="sm" role="group" aria-label="Date range">
					<UButton
						v-for="option in PRESETS"
						:key="option.value"
						:label="option.label"
						:color="preset === option.value ? 'primary' : 'neutral'"
						:variant="preset === option.value ? 'subtle' : 'outline'"
						:aria-pressed="preset === option.value"
						:disabled="!presetAllowed(option.value)"
						@click="selectPreset(option.value)"
					/>
				</UFieldGroup>

				<div class="flex flex-wrap items-start gap-x-4 gap-y-3">
					<UFormField
						label="From (UTC)"
						size="sm"
						:error="inputErrors.from"
						:ui="{ root: 'flex items-start gap-2', wrapper: 'pt-1.5', error: 'mt-1 max-w-72' }"
					>
						<UInput
							type="date"
							size="sm"
							class="w-38"
							:model-value="fromDate"
							:max="toDate || todayUtc()"
							@update:model-value="(value) => onDateChange('from', value)"
						/>
					</UFormField>
					<UFormField
						label="To (UTC)"
						size="sm"
						:error="inputErrors.to"
						:ui="{ root: 'flex items-start gap-2', wrapper: 'pt-1.5', error: 'mt-1 max-w-72' }"
					>
						<UInput
							type="date"
							size="sm"
							class="w-38"
							:model-value="toDate"
							:min="fromDate || undefined"
							:max="todayUtc()"
							@update:model-value="(value) => onDateChange('to', value)"
						/>
					</UFormField>
				</div>
			</UDashboardToolbar>
		</template>

		<template #body>
			<AccountFeatureGate
				:loaded="capabilitiesLoaded"
				:available="canAnalytics"
				feature="DNS analytics"
				:reason="unavailableReason"
				hint="The token needs Analytics Read for this zone or Account Analytics Read for its account."
				:checking="zoneLoading"
				@retry="zone.refresh()"
			>
				<UAlert
					v-if="loadError"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					title="Couldn’t load DNS analytics"
					:description="loadError"
					:actions="[
						{
							label: 'Try again',
							icon: 'i-lucide-refresh-cw',
							color: 'neutral',
							variant: 'outline',
							loading,
							onClick: () => run({ fresh: true })
						}
					]"
				/>

				<div v-if="!result && loading" class="flex flex-col gap-6">
					<span class="sr-only" role="status">Loading DNS analytics</span>
					<div class="flex flex-col gap-2">
						<USkeleton class="h-4 w-48" />
						<USkeleton class="h-9 w-32" />
						<USkeleton class="h-4 w-64" />
					</div>
					<USkeleton class="h-64 w-full" />
					<div class="grid gap-6 lg:grid-cols-2">
						<USkeleton class="h-48 w-full" />
						<USkeleton class="h-48 w-full" />
					</div>
				</div>

				<UEmpty
					v-else-if="!result && hasInputError"
					icon="i-lucide-calendar-x"
					title="Adjust the date range"
					description="Fix the date marked above to load DNS analytics."
				/>

				<template v-else-if="result">
					<UAlert
						v-if="result.scope === 'account'"
						color="warning"
						variant="subtle"
						icon="i-lucide-info"
						title="Showing queries for the whole account"
					>
						<template #description>
							<p>
								This token can’t read DNS analytics for
								{{ result.zoneName || zoneName || 'this zone' }} on its own, so these figures cover
								every zone in {{ result.accountName || 'the account' }}.
							</p>
							<p v-if="result.zoneUnavailableReason" class="mt-1">
								Cloudflare said: {{ result.zoneUnavailableReason }}
							</p>
						</template>
					</UAlert>

					<UEmpty
						v-if="result.total === 0"
						icon="i-lucide-chart-no-axes-column"
						title="No DNS queries in this range"
						:actions="emptyActions"
					>
						<template #description>
							<p>
								Cloudflare recorded no queries {{ scopeSubject }}
								<template v-if="result.granularity === 'hour'">
									between <time :datetime="result.start">{{ formatHour(result.start) }}</time> and
									<time :datetime="result.end">{{ formatHour(result.end) }}</time> UTC.
								</template>
								<template v-else>
									between <time :datetime="result.from">{{ formatDay(result.from) }}</time> and
									<time :datetime="result.to">{{ formatDay(result.to) }}</time> (UTC).
								</template>
							</p>
							<p v-if="zoneInactive" class="mt-2">
								This zone isn’t active yet, so Cloudflare’s nameservers aren’t answering for it.
							</p>
						</template>
					</UEmpty>

					<template v-else>
						<section
							aria-labelledby="analytics-total-label"
							class="flex flex-col gap-1 transition-opacity"
							:class="loading ? 'opacity-60' : ''"
						>
							<h2 id="analytics-total-label" class="text-muted text-sm">
								DNS queries {{ scopeSubject }}
							</h2>
							<p class="text-highlighted text-3xl font-semibold">
								{{ formatNumber(result.total) }}
							</p>
							<p class="text-muted text-sm">
								<template v-if="result.granularity === 'hour'">
									From <time :datetime="result.start">{{ formatHour(result.start) }}</time> to
									<time :datetime="result.end">{{ formatHour(result.end) }}</time> UTC
								</template>
								<template v-else-if="result.from === result.to">
									On <time :datetime="result.from">{{ formatDay(result.from) }}</time> (UTC)
								</template>
								<template v-else>
									From <time :datetime="result.from">{{ formatDay(result.from) }}</time> to
									<time :datetime="result.to">{{ formatDay(result.to) }}</time> (UTC)
								</template>
							</p>
						</section>

						<AnalyticsChart
							:points="result.series"
							:granularity="result.granularity"
							:title="result.granularity === 'hour' ? 'Queries per hour' : 'Queries per day'"
							:refreshing="loading"
						/>

						<div
							class="grid min-w-0 gap-6 transition-opacity lg:grid-cols-2"
							:class="loading ? 'opacity-60' : ''"
						>
							<section aria-labelledby="query-types-heading" class="flex min-w-0 flex-col gap-2">
								<h2 id="query-types-heading" class="text-highlighted text-sm font-semibold">
									Query types
								</h2>
								<UTable
									:data="queryTypeRows"
									:columns="breakdownColumns('Type')"
									:ui="{ th: 'px-3 py-2', td: 'px-3 py-2' }"
								>
									<template #name-cell="{ row }">
										<span
											:class="row.original.other ? 'text-muted' : 'text-highlighted font-medium'"
										>
											{{ row.original.name }}
										</span>
									</template>
									<template #count-cell="{ row }">{{ formatNumber(row.original.count) }}</template>
									<template #share-cell="{ row }">{{ formatShare(row.original.share) }}</template>
								</UTable>
							</section>

							<section aria-labelledby="response-codes-heading" class="flex min-w-0 flex-col gap-2">
								<h2 id="response-codes-heading" class="text-highlighted text-sm font-semibold">
									Response codes
								</h2>
								<UTable
									:data="responseCodeRows"
									:columns="breakdownColumns('Code')"
									:ui="{ th: 'px-3 py-2', td: 'px-3 py-2' }"
								>
									<template #name-cell="{ row }">
										<span v-if="row.original.other" class="text-muted">{{
											row.original.name
										}}</span>
										<span v-else class="flex flex-col whitespace-normal">
											<span class="text-highlighted font-medium">{{ row.original.name }}</span>
											<span v-if="RESPONSE_CODES[row.original.name]" class="text-muted text-xs">
												{{ RESPONSE_CODES[row.original.name] }}
											</span>
										</span>
									</template>
									<template #count-cell="{ row }">{{ formatNumber(row.original.count) }}</template>
									<template #share-cell="{ row }">{{ formatShare(row.original.share) }}</template>
								</UTable>
							</section>
						</div>
					</template>

					<UCollapsible class="flex flex-col gap-2">
						<UButton
							label="Raw GraphQL response"
							color="neutral"
							variant="ghost"
							size="sm"
							trailing-icon="i-lucide-chevron-down"
							class="group self-start"
							:ui="{ trailingIcon: 'transition-transform group-data-[state=open]:rotate-180' }"
						/>
						<template #content>
							<div class="flex flex-col gap-2">
								<UButton
									label="Copy JSON"
									icon="i-lucide-copy"
									color="neutral"
									variant="outline"
									size="xs"
									class="self-start"
									@click="notify.copy(rawJson, 'JSON')"
								/>
								<pre
									class="bg-muted text-default max-h-[32rem] overflow-auto rounded-lg p-4 font-mono text-xs"
									>{{ rawJson }}</pre>
							</div>
						</template>
					</UCollapsible>
				</template>
			</AccountFeatureGate>
		</template>
	</UDashboardPanel>
</template>

<script setup>
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Long enough that typing a date segment by segment sends one request, not one per key.
const INPUT_DEBOUNCE_MS = 600

const PRESETS = [
	{ value: '24h', label: 'Last 24 hours' },
	{ value: '7d', label: 'Last 7 days' },
	{ value: '30d', label: 'Last 30 days' }
]
// How far back each preset reaches, compared with the dataset limits the last answer reported.
const PRESET_SECONDS = { '24h': 86_400, '7d': 7 * 86_400, '30d': 30 * 86_400 }

const RESPONSE_CODES = {
	NOERROR: 'Answered, possibly with no records',
	NXDOMAIN: 'Name doesn’t exist',
	SERVFAIL: 'Server failure',
	REFUSED: 'Query refused',
	FORMERR: 'Malformed query',
	NOTIMP: 'Query type not supported',
	NOTAUTH: 'Not authoritative for the zone'
}

const route = useRoute()
const { call } = useCfApi()
const notify = useNotify()

const zone = useZone(() => route.params.zone_id)
const { zoneId, zoneName, capabilitiesLoaded, missingCapabilities } = zone
const zoneLoading = zone.loading
const canAnalytics = computed(() => zone.can('accountAnalytics'))
const unavailableReason = computed(
	() => missingCapabilities.value.find((item) => item.key === 'accountAnalytics')?.reason || ''
)
const zoneInactive = computed(() => Boolean(zone.zone.value?.status) && zone.zone.value.status !== 'active')

useSeoMeta({ title: computed(() => (zoneName.value ? `Analytics · ${zoneName.value}` : 'Analytics')) })

const percentFormat = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 })
const dayFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const hourFormat = new Intl.DateTimeFormat(LOCALE, {
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
	timeZone: 'UTC'
})

const formatDay = (date) => dayFormat.format(Date.parse(`${date}T00:00:00Z`))
const formatHour = (iso) => hourFormat.format(Date.parse(iso))
const formatShare = (share) => (share > 0 && share < 0.001 ? '<0.1%' : percentFormat.format(share))

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10)
const todayUtc = () => isoDate(Date.now())

// Mirrors the server's preset windows so the date fields show what a preset covers
// before the response arrives.
const presetDates = (value) => {
	const now = Date.now()
	if (value === '24h') return { from: isoDate(Math.floor(now / HOUR_MS) * HOUR_MS - 23 * HOUR_MS), to: isoDate(now) }
	const days = value === '30d' ? 30 : 7
	return { from: isoDate(now - (days - 1) * DAY_MS), to: isoDate(now) }
}

const preset = ref('7d')
const fromDate = ref(presetDates('7d').from)
const toDate = ref(presetDates('7d').to)

const result = ref(null)
const loading = ref(false)
const loadError = ref('')
const inputErrors = reactive({ from: '', to: '' })
const hasInputError = computed(() => Boolean(inputErrors.from || inputErrors.to))

// A preset Cloudflare's dataset can't cover is turned off rather than offered and then
// refused. Before any answer the limits are unknown, so every preset stays available.
const presetAllowed = (value) => {
	const limits = result.value?.limits
	const need = PRESET_SECONDS[value]
	if (!limits || !need) return true
	return (!limits.notOlderThan || limits.notOlderThan >= need) && (!limits.maxDuration || limits.maxDuration >= need)
}

let requestId = 0
let debounceTimer

const validateCustomRange = () => {
	if (!DATE_RE.test(fromDate.value)) inputErrors.from = 'Enter a From date'
	if (!DATE_RE.test(toDate.value)) inputErrors.to = 'Enter a To date'
	if (hasInputError.value) return false
	if (fromDate.value > toDate.value) inputErrors.to = 'To must be on or after From'
	else if (toDate.value > todayUtc()) inputErrors.to = 'To can’t be later than today (UTC)'
	return !hasInputError.value
}

const run = async ({ fresh = false } = {}) => {
	clearTimeout(debounceTimer)
	if (!zoneId.value || !canAnalytics.value) return

	inputErrors.from = ''
	inputErrors.to = ''
	const requestedPreset = preset.value
	const custom = requestedPreset === 'custom'
	// Any newer run, even one stopped by validation, makes an in-flight answer stale.
	const id = ++requestId
	if (custom && !validateCustomRange()) {
		loading.value = false
		return
	}

	loading.value = true
	loadError.value = ''

	try {
		const response = await call(
			'account_analytics',
			{
				currZone: zoneId.value,
				...(custom ? { from: fromDate.value, to: toDate.value } : { preset: preset.value }),
				fresh
			},
			{ fallback: 'Couldn’t load DNS analytics' }
		)
		if (id !== requestId) return
		result.value = response.result
		// Leave the fields alone if someone started typing a custom range meanwhile.
		if (!custom && preset.value === requestedPreset) {
			fromDate.value = response.result.from
			toDate.value = response.result.to
		}
	} catch (error) {
		if (id !== requestId) return
		// Range problems (outside what Cloudflare keeps, too long) belong beside the dates.
		// A rejected preset clears the old figures, which no longer match the selected range.
		// A typed range keeps them, labelled with their own dates, so pausing mid-date
		// doesn't blank the page.
		if (isInputError(error)) {
			inputErrors.from = describeError(error)
			if (!custom) result.value = null
		} else loadError.value = describeError(error, 'Couldn’t load DNS analytics')
	} finally {
		if (id === requestId) loading.value = false
	}
}

const selectPreset = (value) => {
	preset.value = value
	const dates = presetDates(value)
	fromDate.value = dates.from
	toDate.value = dates.to
	run()
}

const onDateChange = (field, value) => {
	if (field === 'from') fromDate.value = value || ''
	else toDate.value = value || ''
	preset.value = 'custom'
	inputErrors[field] = ''
	clearTimeout(debounceTimer)
	debounceTimer = setTimeout(() => run(), INPUT_DEBOUNCE_MS)
}

const scopeSubject = computed(() => {
	if (!result.value) return ''
	return result.value.scope === 'account'
		? `to all zones in ${result.value.accountName || 'this account'}`
		: `to ${result.value.zoneName || zoneName.value || 'this zone'}`
})

const emptyActions = computed(() =>
	preset.value === '30d' || !presetAllowed('30d')
		? [
				{
					label: 'Refresh',
					icon: 'i-lucide-refresh-cw',
					color: 'neutral',
					variant: 'outline',
					onClick: () => run({ fresh: true })
				}
			]
		: [{ label: 'Show the last 30 days', color: 'neutral', variant: 'outline', onClick: () => selectPreset('30d') }]
)

const breakdownColumns = (nameHeader) => [
	{ accessorKey: 'name', header: nameHeader },
	{ accessorKey: 'count', header: 'Queries', meta: { class: { th: 'text-end', td: 'text-end tabular-nums' } } },
	{ accessorKey: 'share', header: 'Share', meta: { class: { th: 'text-end', td: 'text-end tabular-nums' } } }
]

// Cloudflare returns the top groups only; whatever they don't cover becomes one "Other" row
// so the shares still account for every query.
const withShares = (rows, total, otherLabel) => {
	if (!total) return []
	const listed = rows.reduce((sum, row) => sum + row.count, 0)
	const shaped = rows.map((row) => ({ ...row, share: row.count / total }))
	const rest = total - listed
	if (rest > 0) shaped.push({ name: otherLabel, other: true, count: rest, share: rest / total })
	return shaped
}

const queryTypeRows = computed(() =>
	withShares(result.value?.queryTypes || [], result.value?.total || 0, 'Other types')
)
const responseCodeRows = computed(() =>
	withShares(result.value?.responseCodes || [], result.value?.total || 0, 'Other codes')
)

const rawJson = computed(() => JSON.stringify(result.value?.raw ?? null, null, 2))

watch(zoneId, () => {
	requestId++
	result.value = null
	loadError.value = ''
	loading.value = false
	inputErrors.from = ''
	inputErrors.to = ''
})

watch(
	[zoneId, canAnalytics],
	([id, allowed]) => {
		if (id && allowed) run()
	},
	{ immediate: true }
)

onMounted(() => {
	zone.load()
})

onBeforeUnmount(() => clearTimeout(debounceTimer))
</script>
