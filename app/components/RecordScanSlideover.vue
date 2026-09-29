<template>
	<USlideover
		v-model:open="open"
		title="Scan for records"
		:description="`Cloudflare looks up common records, such as www and MX, at the domain’s current DNS provider. Nothing is added to ${zoneName || 'this zone'} until you accept it.`"
		:dismissible="!reviewing"
		:close="!reviewing"
		:ui="{ content: 'sm:max-w-xl', footer: 'flex-col items-stretch gap-3' }"
	>
		<template #body>
			<div class="flex flex-col gap-4">
				<section v-if="outcomes.length" :aria-labelledby="outcomeHeadingId" class="flex flex-col gap-2">
					<h3 :id="outcomeHeadingId" class="text-highlighted text-sm font-semibold">Reviewed</h3>
					<ul class="flex flex-col gap-1">
						<li
							v-for="outcome in outcomes"
							:key="outcome.id"
							class="flex min-w-0 items-center gap-2 text-sm"
						>
							<UIcon
								name="i-lucide-circle-check"
								class="text-success size-4 shrink-0"
								aria-hidden="true"
							/>
							<span class="text-default">{{ outcome.text }}</span>
						</li>
					</ul>
				</section>

				<div v-if="results === null && listLoading" role="status" class="flex flex-col gap-3">
					<span class="sr-only">Checking for results from an earlier scan</span>
					<div v-for="line in 4" :key="line" class="flex items-center gap-3">
						<USkeleton class="size-4 rounded-sm" />
						<USkeleton class="h-5 w-12" />
						<USkeleton class="h-4 flex-1" />
					</div>
				</div>

				<UAlert
					v-else-if="results === null && listError"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					title="Couldn’t load the scan results"
					:description="listError"
					:actions="[
						{
							label: 'Try again',
							icon: 'i-lucide-refresh-cw',
							color: 'neutral',
							variant: 'outline',
							loading: listLoading,
							onClick: loadResults
						}
					]"
				/>

				<template v-else-if="results">
					<div
						v-if="items.length || polling"
						class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
					>
						<div class="flex min-w-0 flex-col gap-0.5">
							<p role="status" class="text-default flex items-center gap-2 text-sm">
								<UIcon
									v-if="polling"
									name="i-lucide-loader-circle"
									class="text-muted size-4 shrink-0 animate-spin"
									aria-hidden="true"
								/>
								<span>{{ statusLabel }}</span>
							</p>
							<p v-if="checkedAt" class="text-dimmed text-xs">
								Last checked at
								<time :datetime="checkedAt.toISOString()">{{ formatTime(checkedAt) }}</time>
							</p>
						</div>
						<div class="flex flex-wrap items-center gap-1">
							<UButton
								v-if="!polling"
								label="Scan again"
								icon="i-lucide-scan-search"
								color="neutral"
								variant="ghost"
								size="sm"
								:loading="starting"
								:disabled="!canStart"
								@click="startScan"
							/>
							<UButton
								label="Check again"
								icon="i-lucide-refresh-cw"
								color="neutral"
								variant="ghost"
								size="sm"
								:loading="listLoading"
								:disabled="Boolean(reviewing)"
								@click="checkNow"
							/>
						</div>
					</div>

					<UAlert
						v-if="listError"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						title="Couldn’t check for new results"
						:description="
							items.length ? `${sentence(listError)} The list below may be out of date.` : listError
						"
					/>

					<UEmpty v-if="!items.length" v-bind="emptyState" variant="naked" />

					<div v-else class="flex flex-col gap-1">
						<UCheckbox
							:model-value="allSelected"
							label="Select all"
							:disabled="Boolean(reviewing)"
							class="py-1"
							@update:model-value="selectAll"
						/>
						<ul
							class="divide-default border-default divide-y border-y"
							aria-label="Records found by the scan"
						>
							<li v-for="item in items" :key="item.id" class="py-2.5">
								<UCheckbox
									:model-value="Boolean(selection[item.id])"
									:disabled="Boolean(reviewing)"
									:ui="{
										wrapper: 'min-w-0',
										label: 'flex min-w-0 flex-wrap items-center gap-2',
										description: 'mt-1 font-mono text-xs break-all'
									}"
									@update:model-value="(value) => toggle(item.id, value)"
								>
									<template #label>
										<UBadge
											:color="getRecordTypeColor(item.type)"
											variant="subtle"
											size="sm"
											class="shrink-0 font-mono"
										>
											{{ item.type }}
										</UBadge>
										<span
											class="text-highlighted min-w-0 truncate text-sm font-medium"
											:title="item.record.name"
										>
											{{ item.displayName }}
										</span>
										<UBadge
											v-if="item.record.proxied"
											color="primary"
											variant="outline"
											size="sm"
											class="shrink-0"
										>
											Proxied
										</UBadge>
									</template>
									<template #description>
										<span v-if="item.priority !== null" class="text-dimmed"
											><span class="sr-only">Priority </span>{{ item.priority }}&nbsp;</span
										>{{ item.value }}
									</template>
								</UCheckbox>
							</li>
						</ul>
					</div>
				</template>
			</div>
		</template>

		<template #footer>
			<UAlert
				v-if="notice"
				role="alert"
				:color="notice.color"
				variant="subtle"
				:icon="notice.color === 'error' ? 'i-lucide-circle-alert' : 'i-lucide-triangle-alert'"
				:title="notice.title"
				:description="notice.description"
			/>
			<div class="flex w-full flex-wrap items-center justify-between gap-2">
				<UButton
					label="Close"
					color="neutral"
					variant="ghost"
					:disabled="Boolean(reviewing)"
					@click="open = false"
				/>
				<div class="flex flex-wrap justify-end gap-2">
					<template v-if="items.length">
						<UButton
							icon="i-lucide-x"
							color="neutral"
							variant="outline"
							:label="
								selectedItems.length
									? `Discard ${formatNumber(selectedItems.length)}`
									: 'Discard selected'
							"
							:loading="reviewing === 'reject'"
							:disabled="!canReview"
							@click="review('reject')"
						/>
						<UButton
							icon="i-lucide-plus"
							:label="
								selectedItems.length ? `Add ${plural(selectedItems.length, 'record')}` : 'Add selected'
							"
							:loading="reviewing === 'accept'"
							:disabled="!canReview"
							@click="review('accept')"
						/>
					</template>
					<UButton
						v-else-if="!polling"
						icon="i-lucide-scan-search"
						:label="scanStarted ? 'Scan again' : 'Start scan'"
						:loading="starting"
						:disabled="!canStart"
						@click="startScan"
					/>
				</div>
			</div>
		</template>
	</USlideover>
</template>

<script setup>
// Record scan review: starts Cloudflare's asynchronous scan of the domain's current DNS
// provider, lists what it finds, and accepts (adds to the zone) or rejects (discards) the
// selected results. Results from an earlier scan show as soon as the panel opens.
const props = defineProps({
	zoneId: { type: String, required: true },
	zoneName: { type: String, default: '' }
})

const open = defineModel('open', { type: Boolean, default: false })

// About a minute of checks after a scan starts; Check again covers anything later.
const POLL_INTERVAL_MS = 5_000
const POLL_LIMIT = 12
// Fields sent back when accepting a result: its ID and the record as Cloudflare listed it,
// without the ones Cloudflare sets itself.
const ACCEPT_FIELDS = ['id', 'type', 'name', 'content', 'priority', 'ttl', 'proxied', 'comment', 'tags', 'settings']

const { exec } = useCfCommands()
const notify = useNotify()
const { getRecordTypeColor, formatContent } = useRecordTypes()
const zoneRecords = useZoneRecords(() => props.zoneId)
const outcomeHeadingId = useId()

// null until the first list arrives, so loading and "nothing found" look different.
const results = ref(null)
const listLoading = ref(false)
const listError = ref('')
const checkedAt = ref(null)
const selection = ref({})
const scanStarted = ref(false)
const starting = ref(false)
const polling = ref(false)
// 'accept' or 'reject' while a review is in flight.
const reviewing = ref('')
const notice = ref(null)
const outcomes = ref([])

// Results accepted or rejected in this session. Kept out of later lists in case Cloudflare
// still returns them for a moment, so nothing is accepted twice.
const reviewedIds = new Set()
let listToken = 0
let pollRun = 0
let polls = 0
let timer = null
let outcomeCount = 0

const sentence = (text) => {
	const value = String(text || '').trim()
	return !value || /[.!?]$/.test(value) ? value : `${value}.`
}

const collator = new Intl.Collator(LOCALE, { numeric: true, sensitivity: 'base' })
const byName = (a, b) => {
	if (a.displayName === b.displayName) return 0
	if (a.displayName === '@') return -1
	if (b.displayName === '@') return 1
	return collator.compare(a.displayName, b.displayName)
}

// Sorted as the records table sorts by default, so rows don't jump about between checks.
const items = computed(() =>
	(results.value || [])
		.map((record) => ({
			id: record.id,
			record,
			type: record.type,
			displayName: relativeName(record.name, props.zoneName),
			value: formatContent(record),
			priority: record.type === 'MX' && Number.isFinite(record.priority) ? record.priority : null
		}))
		.sort((a, b) => collator.compare(a.type, b.type) || byName(a, b))
)

const selectedItems = computed(() => items.value.filter((item) => selection.value[item.id]))
const allSelected = computed(() => {
	if (!selectedItems.value.length) return false
	return selectedItems.value.length === items.value.length ? true : 'indeterminate'
})
const canReview = computed(() => selectedItems.value.length > 0 && !reviewing.value && !starting.value)
const canStart = computed(
	() => !starting.value && !reviewing.value && !polling.value && !(results.value === null && listLoading.value)
)

const statusLabel = computed(() => {
	const count = items.value.length
	if (polling.value) {
		return count
			? `Found ${plural(count, 'record')} so far. Still scanning.`
			: 'Scanning. Checking for results every 5 seconds.'
	}
	if (!scanStarted.value) {
		return `${plural(count, 'record')} from an earlier scan ${count === 1 ? 'is' : 'are'} waiting for review.`
	}
	return `Found ${plural(count, 'record')}. The scan may find more, so check again later if any are missing.`
})

const emptyState = computed(() => {
	if (outcomes.value.length) {
		return {
			icon: 'i-lucide-list-checks',
			title: 'Nothing left to review',
			description: polling.value
				? 'Every record found so far has been added or discarded. Cloudflare is still looking.'
				: 'Every record the scan found has been added or discarded.'
		}
	}
	if (polling.value) {
		return {
			icon: 'i-lucide-scan-search',
			title: 'The scan found no records yet',
			description: 'Cloudflare is still looking. Records appear here as it finds them.'
		}
	}
	if (scanStarted.value) {
		return {
			icon: 'i-lucide-scan-search',
			title: 'The scan found no records yet',
			description: 'The scan may still be running. Check again shortly, or add the records yourself.',
			actions: [
				{
					label: 'Check again',
					icon: 'i-lucide-refresh-cw',
					color: 'neutral',
					variant: 'outline',
					loading: listLoading.value,
					onClick: checkNow
				}
			]
		}
	}
	return {
		icon: 'i-lucide-scan-search',
		title: 'No scan results yet',
		description:
			'Start a scan to look for common records at the domain’s current DNS provider. Results appear here as Cloudflare finds them.'
	}
})

// List

const setResults = (list) => {
	const found = (Array.isArray(list) ? list : []).filter((record) => record?.id && !reviewedIds.has(record.id))
	const present = new Set(found.map((record) => record.id))
	results.value = found
	keepSelected((id) => present.has(id))
}

// Never throws; a failure lands in listError. Answers for another zone, or older than the
// newest request, are dropped.
const loadResults = async () => {
	const zone = props.zoneId
	if (!zone) return
	const token = ++listToken
	listLoading.value = true
	listError.value = ''
	try {
		const response = await exec('dns records scan-list', { zone }, { fallback: 'Couldn’t load the scan results' })
		if (token !== listToken) return
		setResults(response?.result)
		checkedAt.value = new Date()
	} catch (error) {
		if (token !== listToken) return
		listError.value = describeError(error, 'Couldn’t load the scan results')
	} finally {
		if (token === listToken) listLoading.value = false
	}
}

// Scan

const stopPolling = () => {
	pollRun += 1
	clearTimeout(timer)
	timer = null
	polling.value = false
}

const poll = async () => {
	const run = pollRun
	clearTimeout(timer)
	timer = null
	await loadResults()
	if (run !== pollRun) return
	polls += 1
	// A failure stops the checks rather than repeating it every few seconds.
	if (listError.value || polls >= POLL_LIMIT) stopPolling()
	else timer = setTimeout(poll, POLL_INTERVAL_MS)
}

const startPolling = () => {
	stopPolling()
	polls = 0
	polling.value = true
	timer = setTimeout(poll, POLL_INTERVAL_MS)
}

// While polling, an early check counts as one of the automatic ones and restarts the wait.
const checkNow = () => {
	if (listLoading.value) return
	if (polling.value) poll()
	else loadResults()
}

const startScan = async () => {
	if (!canStart.value) return
	const zone = props.zoneId
	starting.value = true
	notice.value = null
	try {
		await exec('dns records scan-trigger', { zone }, { fallback: 'Cloudflare didn’t start the scan' })
		if (zone !== props.zoneId || !open.value) return
		scanStarted.value = true
		if (results.value === null) results.value = []
		startPolling()
	} catch (error) {
		if (zone !== props.zoneId) return
		notice.value = {
			color: 'error',
			title: 'Couldn’t start the scan',
			description: describeError(error, 'Try again in a moment.')
		}
	} finally {
		starting.value = false
	}
}

// Review

// Types with structured data take `data`; their `content` is Cloudflare's formatted copy.
const toAccept = (record) => {
	const fields = Object.fromEntries(
		ACCEPT_FIELDS.filter((key) => record[key] !== undefined && record[key] !== null).map((key) => [
			key,
			record[key]
		])
	)
	if (record.data && typeof record.data === 'object') {
		delete fields.content
		fields.data = record.data
	}
	return fields
}

const recordKey = (record) => `${record?.type}|${String(record?.name || '').toLowerCase()}|${record?.content || ''}`

// Cloudflare answers with the records it added and the IDs it discarded. When it lists
// fewer than were sent, only the ones it lists count as done; the rest stay selected.
const confirmedItems = (chosen, listed) => {
	if (!Array.isArray(listed) || listed.length >= chosen.length) return chosen
	const ids = new Set(listed.map((entry) => (typeof entry === 'string' ? entry : entry?.id)).filter(Boolean))
	const keys = new Set(listed.filter((entry) => entry && typeof entry === 'object').map(recordKey))
	return chosen.filter((item) => ids.has(item.id) || keys.has(recordKey(item.record)))
}

const review = async (action) => {
	const chosen = selectedItems.value
	if (!chosen.length || !canReview.value) return
	const accepting = action === 'accept'
	const zone = props.zoneId
	const zoneLabel = props.zoneName || 'this zone'
	reviewing.value = action
	notice.value = null

	try {
		const response = await exec(
			'dns records scan-review',
			{
				zone,
				flags: accepting
					? { accepts: chosen.map((item) => toAccept(item.record)) }
					: { rejects: chosen.map((item) => ({ id: item.id })) }
			},
			{ fallback: accepting ? 'Cloudflare didn’t add these records' : 'Cloudflare didn’t discard these records' }
		)
		const done = confirmedItems(chosen, accepting ? response?.result?.accepts : response?.result?.rejects)
		// The change has happened even if the zone has since changed, so it's still reported.
		if (accepting && done.length) notify.success(`Added ${plural(done.length, 'record')} to ${zoneLabel}`)
		if (zone !== props.zoneId) return

		const doneIds = new Set(done.map((item) => item.id))
		for (const id of doneIds) reviewedIds.add(id)
		results.value = (results.value || []).filter((record) => !doneIds.has(record.id))
		keepSelected((id) => !doneIds.has(id))
		if (accepting && done.length) zoneRecords.refresh()

		if (done.length) {
			outcomeCount += 1
			outcomes.value = [
				...outcomes.value,
				{
					id: outcomeCount,
					text: accepting
						? `Added ${plural(done.length, 'record')} to ${zoneLabel}`
						: `Discarded ${plural(done.length, 'record')}`
				}
			]
		}

		const missed = chosen.length - done.length
		if (missed) {
			notice.value = {
				color: 'warning',
				title: `${accepting ? 'Added' : 'Discarded'} ${formatNumber(done.length)} of ${plural(chosen.length, 'record')}`,
				description: `Cloudflare didn’t confirm the ${missed === 1 ? 'record' : `${formatNumber(missed)} records`} still selected. Check again to see whether ${missed === 1 ? 'it’s' : 'they’re'} still waiting for review.`
			}
		}
	} catch (error) {
		if (zone !== props.zoneId) return
		notice.value = {
			color: 'error',
			title: accepting ? 'Couldn’t add the selected records' : 'Couldn’t discard the selected records',
			description: describeError(error, 'Try again in a moment.')
		}
	} finally {
		reviewing.value = ''
	}
}

// Selection

const keepSelected = (keep) => {
	selection.value = Object.fromEntries(
		Object.keys(selection.value)
			.filter(keep)
			.map((id) => [id, true])
	)
}

const toggle = (id, value) => {
	const { [id]: _removed, ...rest } = selection.value
	selection.value = value ? { ...rest, [id]: true } : rest
}

const selectAll = (value) => {
	selection.value = value ? Object.fromEntries(items.value.map((item) => [item.id, true])) : {}
}

// Lifecycle: every opening starts from Cloudflare's current list; closing stops the checks
// and drops any answer still on its way.

const reset = () => {
	stopPolling()
	listToken += 1
	results.value = null
	listLoading.value = false
	listError.value = ''
	checkedAt.value = null
	selection.value = {}
	scanStarted.value = false
	notice.value = null
	outcomes.value = []
	reviewedIds.clear()
}

watch(
	open,
	(isOpen) => {
		if (isOpen) {
			reset()
			loadResults()
			return
		}
		stopPolling()
		listToken += 1
		listLoading.value = false
	},
	{ immediate: true }
)

watch(
	() => props.zoneId,
	() => {
		reset()
		if (open.value) loadResults()
	}
)

onBeforeUnmount(stopPolling)
</script>
