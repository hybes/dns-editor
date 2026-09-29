<template>
	<UsageSection
		v-if="!denied || billingReadable"
		title="Billable usage"
		:loading="loading"
		:error="denied ? '' : error"
		error-title="Couldn’t load billable usage"
		@retry="load"
	>
		<template #description>
			<p>
				Metered usage in the period by product, from Cloudflare’s billable usage API. It includes usage inside
				free allowances, so a line can cost nothing. Plan fees are under Subscriptions.
			</p>
			<p class="mt-1">Cloudflare marks this API as alpha. Until a billing period ends, its figures can change.</p>
		</template>

		<p v-if="denied" class="text-muted text-sm">
			Cloudflare didn’t let this account use its billable usage API, though the token can read billing. The API is
			in alpha and not open to every account yet.
		</p>

		<div v-else-if="loading && !loaded" class="flex flex-col gap-3">
			<span class="sr-only" role="status">Loading billable usage…</span>
			<USkeleton v-for="row in 5" :key="row" class="h-6 w-full" />
		</div>

		<UEmpty
			v-else-if="loaded && !error && !groups.length"
			variant="naked"
			icon="i-lucide-receipt"
			title="Nothing billable in this period"
			:description="`Cloudflare reported no metered usage for this account ${periodLabel ? `from ${periodLabel}` : 'in this period'}.`"
		/>

		<template v-else-if="groups.length">
			<p v-if="!anyCost" class="text-muted text-sm">
				Cloudflare doesn’t include costs in this API yet, so only quantities are shown.
			</p>

			<div class="overflow-x-auto transition-opacity" :class="loading ? 'opacity-60' : ''">
				<table class="min-w-full text-sm">
					<caption class="sr-only">
						Billable usage by product{{
							periodLabel ? `, ${periodLabel}` : ''
						}}
					</caption>
					<thead class="border-default border-b">
						<tr>
							<th scope="col" class="text-highlighted px-2 py-3 text-start font-semibold sm:px-4">
								Metric
							</th>
							<th scope="col" class="text-highlighted px-2 py-3 text-end font-semibold sm:px-4">
								Quantity
							</th>
							<th
								v-if="anyCost"
								scope="col"
								class="text-highlighted px-2 py-3 text-end font-semibold sm:px-4"
							>
								Cost
							</th>
						</tr>
					</thead>
					<tbody v-for="group in groups" :key="group.name" class="divide-default divide-y">
						<tr>
							<th
								scope="rowgroup"
								:colspan="anyCost ? 3 : 2"
								class="text-highlighted bg-elevated/50 px-2 py-2 text-start font-medium sm:px-4"
							>
								{{ group.name }}
							</th>
						</tr>
						<tr v-for="line in group.lines" :key="line.key">
							<th scope="row" class="text-default px-2 py-3 text-start align-top font-normal sm:px-4">
								<span class="block min-w-28 whitespace-normal sm:min-w-40">{{ line.name }}</span>
								<span v-if="line.zones.length === 1" class="text-muted block text-xs">
									{{ line.zones[0] }}
								</span>
							</th>
							<td class="text-default px-2 py-3 text-end align-top whitespace-nowrap sm:px-4">
								<span class="tabular-nums">{{ formatQuantity(line.quantity) }}</span>
								<span v-if="line.unit" class="text-muted ms-1">{{ line.unit }}</span>
							</td>
							<td
								v-if="anyCost"
								class="text-default px-2 py-3 text-end align-top whitespace-nowrap sm:px-4"
							>
								<UsageMoney v-if="line.costed" :amount="line.cost" :currency="line.currency" precise />
								<span v-else class="text-dimmed">Not given</span>
								<span v-if="line.costed && line.costed < line.records" class="text-muted block text-xs">
									Some days have no cost yet
								</span>
							</td>
						</tr>
					</tbody>
					<tfoot v-if="totals.length" class="border-default border-t">
						<tr v-for="total in totals" :key="total.currency">
							<th scope="row" class="text-highlighted px-2 py-3 text-start font-semibold sm:px-4">
								Total{{ totals.length > 1 ? ` in ${total.currency}` : '' }}
							</th>
							<td class="px-2 py-3 sm:px-4" />
							<td class="text-highlighted px-2 py-3 text-end font-semibold whitespace-nowrap sm:px-4">
								<UsageMoney :amount="total.amount" :currency="total.currency" />
							</td>
						</tr>
					</tfoot>
				</table>
			</div>

			<p class="text-dimmed text-xs text-pretty">
				Cloudflare reports each metric day by day; quantities and costs here add up the days in the period{{
					uncostedLines ? '. Lines without a cost aren’t in the total' : ''
				}}.
			</p>
		</template>
	</UsageSection>
</template>

<script setup>
// Metered usage for one account over a period, from `cf billing usage get-account-usage-v2`:
// FOCUS-style records, one per billable metric per day (and per zone for zone metrics), added up
// here by metric and shown under their product family, with a total per currency where
// Cloudflare includes costs.
const props = defineProps({
	account: { type: String, required: true },
	// YYYY-MM-DD, UTC, both days included
	from: { type: String, required: true },
	to: { type: String, required: true },
	// e.g. “1 to 29 September 2026 (UTC)”, for the empty state and the table caption
	periodLabel: { type: String, default: '' },
	// Bumped by the page's Refresh button
	refreshKey: { type: Number, default: 0 },
	// Whether another section has read billing, so a refusal here is the API, not the token
	billingReadable: { type: Boolean, default: false }
})

// { loading, missing, readable, hidden }, for the page's summary of what the token can't read
const emit = defineEmits(['access'])

const { exec } = useCfCommands()

const records = ref([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
// Cloudflare refused for want of a permission; the page explains that once, not each section.
const denied = ref(false)
let requestId = 0

const smallFormat = new Intl.NumberFormat(LOCALE, { maximumSignificantDigits: 4 })
const largeFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 })
const formatQuantity = (value) => (Math.abs(value) < 1 ? smallFormat : largeFormat).format(value)

const isNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))

// The API filters by charge period; this keeps the table to the chosen days whichever way
// Cloudflare treats the end date.
const inPeriod = computed(() =>
	records.value.filter((record) => {
		const day = String(record?.ChargePeriodStart || '').slice(0, 10)
		return !day || (day >= props.from && day <= props.to)
	})
)

const groups = computed(() => {
	const products = new Map()
	for (const record of inPeriod.value) {
		if (!record || typeof record !== 'object') continue
		const product = record.x_ProductFamilyName || record.x_ProductCategoryName || 'Other'
		const id = record.x_BillableMetricId || record.ChargeDescription || 'unknown'
		const unit = record.ConsumedUnit || ''
		const currency = record.BillingCurrency || ''
		const key = `${id}|${unit}|${currency}`
		if (!products.has(product)) products.set(product, new Map())
		const lines = products.get(product)
		if (!lines.has(key)) {
			lines.set(key, {
				key,
				name: record.x_BillableMetricName || record.ChargeDescription || id,
				unit,
				currency,
				quantity: 0,
				cost: 0,
				costed: 0,
				records: 0,
				zoneNames: new Set()
			})
		}
		const line = lines.get(key)
		line.records++
		line.quantity += Number(record.ConsumedQuantity) || 0
		if (isNumber(record.BilledCost)) {
			line.cost += Number(record.BilledCost)
			line.costed++
		}
		if (record.x_ZoneName) line.zoneNames.add(record.x_ZoneName)
	}
	return [...products]
		.map(([name, lines]) => ({
			name,
			lines: [...lines.values()]
				.map(({ zoneNames, ...line }) => ({ ...line, zones: [...zoneNames] }))
				.sort((a, b) => a.name.localeCompare(b.name))
		}))
		.sort((a, b) => a.name.localeCompare(b.name))
})

const lines = computed(() => groups.value.flatMap((group) => group.lines))
const anyCost = computed(() => lines.value.some((line) => line.costed))
const uncostedLines = computed(() => anyCost.value && lines.value.some((line) => !line.costed))

const totals = computed(() => {
	const byCurrency = new Map()
	for (const line of lines.value) {
		if (!line.costed || !line.currency) continue
		byCurrency.set(line.currency, (byCurrency.get(line.currency) || 0) + line.cost)
	}
	return [...byCurrency].map(([currency, amount]) => ({ currency, amount }))
})

const load = async () => {
	const { account, from, to } = props
	if (!account || !from || !to) return
	const id = ++requestId
	loading.value = true
	error.value = ''
	try {
		const response = await exec(
			'billing usage get-account-usage-v2',
			{ account, flags: { from, to } },
			{ fallback: 'Cloudflare didn’t return the billable usage' }
		)
		if (id !== requestId) return
		records.value = Array.isArray(response?.result) ? response.result : []
		denied.value = false
	} catch (failure) {
		if (id !== requestId) return
		error.value = describeError(failure, 'Cloudflare didn’t return the billable usage')
		denied.value = isPermissionError(failure)
		records.value = []
	} finally {
		if (id === requestId) {
			loading.value = false
			loaded.value = true
		}
	}
}

watch(
	() => props.account,
	() => {
		records.value = []
		loaded.value = false
		denied.value = false
	}
)

watch(
	() => ({
		loading: loading.value,
		missing: denied.value && !props.billingReadable ? ['billing'] : [],
		readable: loaded.value && !error.value,
		hidden: denied.value && !props.billingReadable
	}),
	(access) => emit('access', access),
	{ immediate: true }
)

watch(() => [props.account, props.from, props.to, props.refreshKey], load, { immediate: true })
</script>
