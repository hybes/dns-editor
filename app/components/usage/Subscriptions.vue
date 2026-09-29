<template>
	<UsageSection
		v-if="!denied"
		title="Subscriptions"
		:loading="loading"
		:error="error"
		error-title="Couldn’t load the subscriptions"
		@retry="load"
	>
		<template #description>
			<p>Plans and add-ons on the account, with the price Cloudflare bills for each and how often.</p>
		</template>

		<UTable
			v-if="!error || items.length"
			:data="items"
			:columns="columns"
			:loading="loading || !loaded"
			caption="Subscriptions on this account"
			:ui="{ th: 'px-3 py-2', td: 'px-3 py-2' }"
		>
			<template #loading>
				<div class="flex flex-col gap-3" role="status">
					<span class="sr-only">Loading subscriptions…</span>
					<USkeleton v-for="row in 3" :key="row" class="h-6 w-full" />
				</div>
			</template>

			<template #empty>
				<UEmpty
					v-if="loaded && !error"
					variant="naked"
					icon="i-lucide-package"
					title="No subscriptions on this account"
					description="Cloudflare lists no plans or add-ons for it."
				/>
			</template>

			<template #plan-cell="{ row }">
				<div class="flex max-w-[55vw] min-w-0 flex-col gap-0.5 whitespace-normal sm:max-w-96">
					<span class="text-highlighted font-medium">{{ planName(row.original) }}</span>
					<span v-if="row.original.zone?.name" class="text-muted font-mono text-xs">
						{{ row.original.zone.name }}
					</span>
					<span v-if="extras(row.original).length" class="text-muted text-xs">
						{{ extras(row.original).join(' · ') }}
					</span>
					<span class="text-muted text-xs sm:hidden">{{ stateMeta(row.original.state).label }}</span>
				</div>
			</template>

			<template #price-cell="{ row }">
				<UsageMoney :amount="row.original.price" :currency="row.original.currency || 'USD'" />
				<span v-if="FREQUENCIES[row.original.frequency]" class="text-muted">
					{{ FREQUENCIES[row.original.frequency] }}
				</span>
				<span v-else-if="row.original.frequency" class="text-muted"> ({{ row.original.frequency }})</span>
			</template>

			<template #state-cell="{ row }">
				<UBadge
					v-if="row.original.state"
					:color="stateMeta(row.original.state).color"
					variant="subtle"
					size="sm"
				>
					{{ stateMeta(row.original.state).label }}
				</UBadge>
			</template>

			<template #current_period_end-cell="{ row }">
				<time v-if="formatDate(row.original.current_period_end)" :datetime="row.original.current_period_end">
					{{ formatDate(row.original.current_period_end) }}
				</time>
				<span v-else class="text-dimmed">Not given</span>
			</template>
		</UTable>
	</UsageSection>
</template>

<script setup>
// What the account pays Cloudflare for, from `cf accounts subscriptions get`: each plan or add-on
// with its price, how often it's billed, its state and when the current period ends (which is
// also when the next bill is due). Cloudflare documents the price as the amount billed, in the
// subscription's currency (US dollars when none is given).
const props = defineProps({
	account: { type: String, required: true },
	refreshKey: { type: Number, default: 0 }
})

// { loading, missing, readable, hidden }, for the page's summary of what the token can't read
const emit = defineEmits(['access'])

const FREQUENCIES = { weekly: ' a week', monthly: ' a month', quarterly: ' a quarter', yearly: ' a year' }

const STATES = {
	Paid: { label: 'Paid', color: 'success' },
	Provisioned: { label: 'Provisioned', color: 'success' },
	Trial: { label: 'Trial', color: 'info' },
	AwaitingPayment: { label: 'Awaiting payment', color: 'warning' },
	Failed: { label: 'Payment failed', color: 'error' },
	Cancelled: { label: 'Cancelled', color: 'neutral' },
	Expired: { label: 'Expired', color: 'neutral' }
}

const FROM_SM = { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' }
const FROM_MD = { th: 'hidden md:table-cell', td: 'hidden md:table-cell' }

const columns = [
	{ id: 'plan', header: 'Plan' },
	{ accessorKey: 'price', header: 'Price', meta: { class: { td: 'whitespace-nowrap' } } },
	{ accessorKey: 'state', header: 'State', meta: { class: FROM_SM } },
	{ accessorKey: 'current_period_end', header: 'Period ends', meta: { class: FROM_MD } }
]

const { exec } = useCfCommands()

const items = ref([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
// Cloudflare refused for want of a permission; the page explains that once, not each section.
const denied = ref(false)
let requestId = 0

const stateMeta = (state) => STATES[state] || { label: state || 'Unknown', color: 'neutral' }

const planName = (subscription) =>
	subscription.rate_plan?.public_name || subscription.rate_plan?.id || subscription.id || 'Subscription'

// Components set above what the plan includes by default, such as extra seats or rules.
const extras = (subscription) =>
	(subscription.component_values || [])
		.filter(
			(component) => Number(component?.value) > 0 && Number(component.value) !== Number(component.default ?? 0)
		)
		.map((component) => `${component.display_name || component.name}: ${formatNumber(component.value)}`)

const load = async () => {
	const account = props.account
	if (!account) return
	const id = ++requestId
	loading.value = true
	error.value = ''
	try {
		const response = await exec(
			'accounts subscriptions get',
			{ account, target: 'account' },
			{ fallback: 'Cloudflare didn’t return the subscriptions' }
		)
		if (id !== requestId) return
		items.value = (Array.isArray(response?.result) ? response.result : []).filter(
			(item) => item && typeof item === 'object'
		)
		denied.value = false
	} catch (failure) {
		if (id !== requestId) return
		error.value = describeError(failure, 'Cloudflare didn’t return the subscriptions')
		denied.value = isPermissionError(failure)
		items.value = []
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
		items.value = []
		loaded.value = false
		denied.value = false
	}
)

watch(
	() => ({
		loading: loading.value,
		missing: denied.value ? ['billing'] : [],
		readable: loaded.value && !error.value,
		hidden: denied.value
	}),
	(access) => emit('access', access),
	{ immediate: true }
)

watch(() => [props.account, props.refreshKey], load, { immediate: true })
</script>
