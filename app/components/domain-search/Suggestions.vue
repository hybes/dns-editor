<template>
	<section :aria-labelledby="headingId" class="flex flex-col gap-2">
		<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
			<h2 :id="headingId" class="text-highlighted text-base font-semibold">
				Cloudflare suggestions for “{{ query }}”
			</h2>
			<UButton
				v-if="!loading && (items.length || error)"
				label="Refresh"
				icon="i-lucide-refresh-cw"
				size="xs"
				color="neutral"
				variant="ghost"
				@click="load"
			/>
		</div>
		<p class="text-muted text-xs">
			Names Cloudflare Registrar suggests from its own data, which can be a little out of date. The Registrar page
			checks a name again before you register it.
		</p>

		<div v-if="loading" class="flex flex-col gap-2" aria-busy="true">
			<span class="sr-only">Loading suggestions from Cloudflare Registrar…</span>
			<USkeleton v-for="row in 4" :key="row" class="h-10 w-full" />
		</div>

		<p v-else-if="error" class="text-muted flex items-start gap-1.5 text-xs">
			<UIcon name="i-lucide-cloud-off" class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
			<span>Cloudflare Registrar didn’t suggest names: {{ error }}</span>
		</p>

		<p v-else-if="!items.length" class="text-muted text-sm">
			Cloudflare had no suggestions. Try a shorter word or a different phrase.
		</p>

		<ul v-else class="divide-default border-default divide-y border-y">
			<li
				v-for="item in visibleItems"
				:key="item.name"
				class="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:gap-4"
			>
				<div class="min-w-0 flex-1">
					<span class="text-highlighted font-mono text-sm font-semibold break-all">{{ item.name }}</span>
					<p class="text-muted text-xs">{{ note(item) }}</p>
				</div>
				<p v-if="quote(item)" class="text-sm tabular-nums sm:w-44 sm:shrink-0 sm:text-right">
					<span class="text-highlighted font-medium">{{
						formatMoney(quote(item).registration_cost, quote(item).currency)
					}}</span>
					<span class="text-muted text-xs"> first year</span>
				</p>
				<div class="flex shrink-0 flex-wrap items-center gap-1.5">
					<UButton
						v-if="quote(item)"
						size="sm"
						icon="i-lucide-badge-check"
						:to="{ path: '/registrar', query: { ...(account ? { account } : {}), register: item.name } }"
						:aria-label="`Register ${item.name} with Cloudflare`"
					>
						Register
					</UButton>
					<UButton
						size="sm"
						color="neutral"
						variant="outline"
						icon="i-lucide-plus"
						:disabled="added.includes(labelOf(item.name))"
						:aria-label="`Add ${labelOf(item.name)} to the names being compared`"
						@click="emit('add', labelOf(item.name))"
					>
						{{ added.includes(labelOf(item.name)) ? 'Compared' : 'Compare' }}
					</UButton>
					<UButton
						size="sm"
						color="neutral"
						variant="ghost"
						icon="i-lucide-copy"
						:aria-label="`Copy ${item.name}`"
						@click="copy(item.name, item.name)"
					/>
				</div>
			</li>
		</ul>

		<UButton
			v-if="!loading && items.length > visibleItems.length"
			:label="`Show ${items.length - visibleItems.length} more`"
			size="sm"
			color="neutral"
			variant="link"
			class="self-start px-0"
			@click="showAll = true"
		/>
	</section>
</template>

<script setup>
// Cloudflare Registrar's own suggestions for a keyword or phrase (`registrar registrations
// search`), with its price for each. Emits `add` with a name's first label so the page can
// compare it across the chosen endings.
const props = defineProps({
	// The keyword or phrase, as typed
	query: { type: String, required: true },
	account: { type: String, default: '' },
	// Labels already being compared, so their button says so
	added: { type: Array, default: () => [] }
})

const emit = defineEmits(['add'])

const LIMIT = 30
const SHOWN = 8
const CURRENCY = /^[A-Z]{3}$/
const REASONS = {
	extension_not_supported_via_api: 'Cloudflare sells this ending, but not through its API yet.',
	extension_not_supported: 'Cloudflare Registrar doesn’t sell this ending.',
	extension_disallows_registration: 'The registry isn’t accepting new registrations for this ending.',
	domain_premium: 'A premium name, which Cloudflare’s API can’t register.',
	domain_unavailable: 'Looks taken.'
}

const headingId = useId()
const { exec } = useCfCommands()
const { copy } = useNotify()

const items = ref([])
const loading = ref(false)
const error = ref('')
const showAll = ref(false)
let token = 0

const load = async () => {
	const current = ++token
	const query = props.query.trim()
	showAll.value = false
	if (!query) {
		items.value = []
		return
	}
	loading.value = true
	error.value = ''
	try {
		const response = await exec(
			'registrar registrations search',
			{ account: props.account || undefined, flags: { query, limit: LIMIT } },
			{ fallback: 'Cloudflare Registrar didn’t answer' }
		)
		if (current !== token) return
		items.value = (response?.result?.domains || []).filter((item) => typeof item?.name === 'string')
	} catch (reason) {
		if (current !== token) return
		items.value = []
		error.value = describeError(reason, 'Cloudflare Registrar didn’t answer')
	} finally {
		if (current === token) loading.value = false
	}
}

watch(() => [props.query, props.account], load, { immediate: true })

// Available names first, in Cloudflare's order of relevance.
const sorted = computed(() => [...items.value].sort((a, b) => Number(Boolean(quote(b))) - Number(Boolean(quote(a)))))
const visibleItems = computed(() => (showAll.value ? sorted.value : sorted.value.slice(0, SHOWN)))

const quote = (item) =>
	item.registrable === true &&
	item.tier === 'standard' &&
	CURRENCY.test(item.pricing?.currency || '') &&
	item.pricing?.registration_cost
		? item.pricing
		: null

const note = (item) => {
	const pricing = quote(item)
	if (pricing) {
		return Number(pricing.renewal_cost) && Number(pricing.renewal_cost) !== Number(pricing.registration_cost)
			? `Looks available · renews at ${formatMoney(pricing.renewal_cost, pricing.currency)}`
			: 'Looks available'
	}
	return REASONS[item.reason] || 'Cloudflare can’t register it through its API.'
}

// "brand.shop" → "brand", the part compared across endings.
const labelOf = (name) => name.split('.')[0]
</script>
