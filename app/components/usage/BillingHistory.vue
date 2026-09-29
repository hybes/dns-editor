<template>
	<UsageSection
		v-if="!denied"
		title="Billing history"
		:loading="loading"
		:error="error"
		error-title="Couldn’t load the billing history"
		@retry="load()"
	>
		<template #description>
			<p>Charges, payments and invoices on the account, newest first.</p>
		</template>

		<UTable
			v-if="!error || items.length"
			:data="sorted"
			:columns="columns"
			:loading="loading || !loaded"
			caption="Billing history for this account"
			:ui="{ th: 'px-3 py-2', td: 'px-3 py-2' }"
		>
			<template #loading>
				<div class="flex flex-col gap-3" role="status">
					<span class="sr-only">Loading billing history…</span>
					<USkeleton v-for="row in 4" :key="row" class="h-6 w-full" />
				</div>
			</template>

			<template #empty>
				<UEmpty
					v-if="loaded && !error"
					variant="naked"
					icon="i-lucide-scroll-text"
					title="No billing history yet"
					description="Cloudflare has no charges or payments on record for this account."
				/>
			</template>

			<template #occurred_at-cell="{ row }">
				<time v-if="formatDate(row.original.occurred_at)" :datetime="row.original.occurred_at">
					{{ formatDate(row.original.occurred_at) }}
				</time>
				<span v-else class="text-dimmed">Not given</span>
			</template>

			<template #description-cell="{ row }">
				<div class="flex max-w-[50vw] min-w-0 flex-col gap-0.5 whitespace-normal sm:max-w-96">
					<span class="text-highlighted">{{ row.original.description || readable(row.original.type) }}</span>
					<span v-if="kind(row.original)" class="text-muted text-xs">{{ kind(row.original) }}</span>
					<span v-if="row.original.status" class="text-muted text-xs sm:hidden">
						{{ statusMeta(row.original.status).label }}
					</span>
				</div>
			</template>

			<template #amount-cell="{ row }">
				<UsageMoney :amount="row.original.amount" :currency="upper(row.original.currency)" />
				<span v-if="owed(row.original)" class="text-warning block text-xs">
					<UsageMoney :amount="row.original.amount_to_pay" :currency="upper(row.original.currency)" />
					to pay
				</span>
			</template>

			<template #status-cell="{ row }">
				<UBadge
					v-if="row.original.status"
					:color="statusMeta(row.original.status).color"
					variant="subtle"
					size="sm"
				>
					{{ statusMeta(row.original.status).label }}
				</UBadge>
			</template>

			<template #actions-cell="{ row }">
				<div class="flex justify-end gap-1">
					<UButton
						v-if="row.original.receipt_id"
						label="Receipt"
						icon="i-lucide-download"
						size="xs"
						color="neutral"
						variant="ghost"
						:loading="downloading.has(row.original.receipt_id)"
						:aria-label="`Download the receipt for ${describe(row.original)}`"
						@click="downloadReceipt(row.original)"
					/>
					<UButton
						v-if="invoiceUrl(row.original)"
						label="Invoice"
						icon="i-lucide-external-link"
						size="xs"
						color="neutral"
						variant="ghost"
						:to="invoiceUrl(row.original)"
						target="_blank"
						:aria-label="`Open the invoice for ${describe(row.original)} at Cloudflare`"
					/>
				</div>
			</template>
		</UTable>

		<div v-if="more && !error" class="flex flex-col items-center gap-3">
			<UAlert
				v-if="moreError"
				color="error"
				variant="subtle"
				icon="i-lucide-circle-alert"
				role="alert"
				title="Couldn’t load more of the billing history"
				:description="moreError"
			/>
			<UButton
				label="Load more"
				icon="i-lucide-chevrons-down"
				color="neutral"
				variant="outline"
				:loading="loadingMore"
				:disabled="loading"
				@click="load({ more: true })"
			/>
		</div>
	</UsageSection>
</template>

<script setup>
// The account's billing history from `cf accounts billing history list`, a page at a time, with
// a receipt download (`cf accounts billing getReceiptPdf`, which returns the PDF as base64) for
// entries that have one and a link to Cloudflare's hosted invoice where it gives one.
const props = defineProps({
	account: { type: String, required: true },
	refreshKey: { type: Number, default: 0 }
})

// { loading, missing, readable, hidden }, for the page's summary of what the token can't read
const emit = defineEmits(['access'])

const PER_PAGE = 20

// Cloudflare doesn't document the status values, so known words get a colour and anything else
// shows as Cloudflare wrote it.
const STATUS_COLOURS = {
	paid: 'success',
	succeeded: 'success',
	success: 'success',
	completed: 'success',
	pending: 'warning',
	processing: 'info',
	open: 'warning',
	unpaid: 'warning',
	failed: 'error',
	declined: 'error',
	uncollectible: 'error',
	refunded: 'neutral',
	void: 'neutral',
	voided: 'neutral',
	cancelled: 'neutral',
	canceled: 'neutral'
}

const FROM_SM = { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' }

const columns = [
	{ accessorKey: 'occurred_at', header: 'Date', meta: { class: { td: 'whitespace-nowrap' } } },
	{ accessorKey: 'description', header: 'Description' },
	{ accessorKey: 'amount', header: 'Amount', meta: { class: { th: 'text-end', td: 'text-end whitespace-nowrap' } } },
	{ accessorKey: 'status', header: 'Status', meta: { class: FROM_SM } },
	{
		id: 'actions',
		header: () => h('span', { class: 'sr-only' }, 'Documents'),
		meta: { class: { td: 'w-px text-end' } }
	}
]

const { exec } = useCfCommands()
const notify = useNotify()

const items = ref([])
const page = ref(0)
const more = ref(false)
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
// Cloudflare refused for want of a permission; the page explains that once, not each section.
const denied = ref(false)
const loadingMore = ref(false)
const moreError = ref('')
const downloading = reactive(new Set())
let requestId = 0

const upper = (value) => (typeof value === 'string' ? value.toUpperCase() : '')

const readable = (value) => {
	const text = String(value || '').replace(/[_-]+/g, ' ')
	return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

const kind = (entry) => {
	const parts = [entry.type, entry.action].filter(Boolean).map(readable)
	const text = [...new Set(parts)].join(' · ')
	return text && text !== entry.description ? text : ''
}

const statusMeta = (status) => ({
	label: readable(status),
	color: STATUS_COLOURS[String(status).toLowerCase()] || 'neutral'
})

const owed = (entry) => Number(entry.amount_to_pay) > 0

const invoiceUrl = (entry) =>
	typeof entry.hosted_invoice_url === 'string' && entry.hosted_invoice_url.startsWith('https://')
		? entry.hosted_invoice_url
		: ''

const describe = (entry) =>
	[entry.description || readable(entry.type) || 'this entry', formatDate(entry.occurred_at)]
		.filter(Boolean)
		.join(', ')

const sorted = computed(() =>
	[...items.value].sort((a, b) => (Date.parse(b.occurred_at) || 0) - (Date.parse(a.occurred_at) || 0))
)

const mergeById = (current, next) => {
	const seen = new Set(current.map((entry) => entry.id).filter(Boolean))
	return [...current, ...next.filter((entry) => !entry.id || !seen.has(entry.id))]
}

const load = async ({ more: loadMore = false } = {}) => {
	const account = props.account
	if (!account) return
	if (loadMore && (loadingMore.value || !more.value)) return
	const id = loadMore ? requestId : ++requestId
	const nextPage = loadMore ? page.value + 1 : 1
	if (loadMore) {
		loadingMore.value = true
		moreError.value = ''
	} else {
		loading.value = true
		error.value = ''
	}
	try {
		const response = await exec(
			'accounts billing history list',
			{ account, flags: { page: nextPage, 'per-page': PER_PAGE } },
			{ fallback: 'Cloudflare didn’t return the billing history' }
		)
		if (id !== requestId) return
		const entries = (Array.isArray(response?.result) ? response.result : []).filter(
			(entry) => entry && typeof entry === 'object'
		)
		items.value = loadMore ? mergeById(items.value, entries) : entries
		page.value = nextPage
		const total = Number(response?.result_info?.total_count)
		more.value = Number.isFinite(total) && total > 0 ? items.value.length < total : entries.length === PER_PAGE
		if (!loadMore) denied.value = false
	} catch (failure) {
		if (id !== requestId) return
		const message = describeError(failure, 'Cloudflare didn’t return the billing history')
		if (loadMore) moreError.value = message
		else {
			error.value = message
			denied.value = isPermissionError(failure)
			items.value = []
			more.value = false
		}
	} finally {
		if (id === requestId) {
			if (loadMore) loadingMore.value = false
			else {
				loading.value = false
				loaded.value = true
			}
		}
	}
}

const saveFile = (content, type, name) => {
	const url = URL.createObjectURL(new Blob([content], { type }))
	const link = document.createElement('a')
	link.href = url
	link.download = name
	document.body.append(link)
	link.click()
	link.remove()
	// Revoking in the same tick can cancel the download in some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 0)
}

const downloadReceipt = async (entry) => {
	const receipt = entry.receipt_id
	if (!receipt || downloading.has(receipt)) return
	downloading.add(receipt)
	try {
		const response = await exec(
			'accounts billing getReceiptPdf',
			{ account: props.account, args: { 'receipt-id': receipt } },
			{ fallback: 'Cloudflare didn’t return the receipt' }
		)
		// Raw commands come back as { contentType, base64 } for binary files, or { contentType, text }.
		const file = response?.result
		const type = file?.contentType || 'application/pdf'
		if (typeof file?.base64 !== 'string' || !/pdf|octet-stream/i.test(type)) {
			throw new Error(`Cloudflare sent ${file?.contentType || 'something other than a PDF'} instead of a PDF.`)
		}
		const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0))
		saveFile(bytes, 'application/pdf', `cloudflare-receipt-${String(receipt).replace(/[^\w-]+/g, '-')}.pdf`)
	} catch (failure) {
		notify.error('Couldn’t download the receipt', failure, 'Cloudflare didn’t return the receipt')
	} finally {
		downloading.delete(receipt)
	}
}

watch(
	() => props.account,
	() => {
		items.value = []
		page.value = 0
		more.value = false
		moreError.value = ''
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

watch(
	() => [props.account, props.refreshKey],
	() => load(),
	{ immediate: true }
)
</script>
