<template>
	<section :aria-labelledby="headingId" class="flex flex-col gap-3">
		<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
			<h2 :id="headingId" class="text-highlighted text-base font-semibold">
				Every ending Cloudflare sells for <span class="font-mono">{{ names.join(', ') }}</span>
			</h2>
			<UButton
				v-if="!running"
				label="Check again"
				icon="i-lucide-refresh-cw"
				size="xs"
				color="neutral"
				variant="ghost"
				@click="run({ fresh: true })"
			/>
		</div>
		<p class="text-muted text-xs">
			Cloudflare Registrar’s live check of each name against every ending it can register through its API, with
			its price. Registry records and other registrars’ prices aren’t included here.
		</p>

		<div v-if="running" class="flex flex-col gap-2" aria-busy="true">
			<p class="text-muted flex items-center gap-2 text-sm" role="status">
				<UIcon
					name="i-lucide-loader-circle"
					class="size-4 shrink-0 animate-spin motion-reduce:animate-none"
					aria-hidden="true"
				/>
				{{ progressLabel }}
			</p>
			<UProgress v-if="total" :model-value="done" :max="total" size="xs" />
		</div>

		<p v-if="error" class="text-muted flex items-start gap-1.5 text-xs">
			<UIcon name="i-lucide-cloud-off" class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
			<span>{{ error }}</span>
		</p>

		<template v-if="!running && checked.length">
			<p class="text-muted text-sm tabular-nums" aria-live="polite">{{ summary }}</p>

			<UEmpty
				v-if="!available.length"
				variant="naked"
				icon="i-lucide-search-x"
				title="Cloudflare can’t register any of these"
				description="Every ending Cloudflare sells is taken, premium or unavailable for these names. Try a variation or another name."
			/>

			<ul v-else class="divide-default border-default divide-y border-y">
				<li
					v-for="item in visible"
					:key="item.name"
					class="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:gap-4"
				>
					<div class="min-w-0 flex-1">
						<span class="text-highlighted font-mono text-sm font-semibold break-all">{{ item.name }}</span>
						<p v-if="renewalNote(item)" class="text-muted text-xs tabular-nums">{{ renewalNote(item) }}</p>
					</div>
					<p class="text-sm tabular-nums sm:w-40 sm:shrink-0 sm:text-right">
						<span class="text-highlighted font-medium">{{
							formatMoney(item.pricing.registration_cost, item.pricing.currency)
						}}</span>
						<span class="text-muted text-xs"> first year</span>
					</p>
					<div class="flex shrink-0 flex-wrap items-center gap-1.5">
						<UButton
							size="sm"
							icon="i-lucide-badge-check"
							:to="{
								path: '/registrar',
								query: { ...(account ? { account } : {}), register: item.name }
							}"
							:aria-label="`Register ${item.name} with Cloudflare`"
						>
							Register
						</UButton>
						<UButton
							size="sm"
							color="neutral"
							variant="outline"
							icon="i-lucide-plus"
							:disabled="endings.includes(endingOf(item.name))"
							:aria-label="`Add .${endingOf(item.name)} to the endings being compared`"
							@click="emit('add-ending', endingOf(item.name))"
						>
							{{ endings.includes(endingOf(item.name)) ? 'Compared' : 'Compare ending' }}
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
				v-if="available.length > visible.length"
				:label="`Show all ${formatNumber(available.length)}`"
				size="sm"
				color="neutral"
				variant="link"
				class="self-start px-0"
				@click="showAll = true"
			/>
		</template>
	</section>
</template>

<script setup>
// Checks names against every ending Cloudflare Registrar can register through its API: it lists
// the extensions (`registrar extensions list`, kept for the session per account), then asks
// `registrar registrations check` about each name, 20 at a time, a few requests at once.
// Registrable names are listed cheapest first. Emits `add-ending` to compare an ending in the
// main search.
const props = defineProps({
	// Labels without an ending, such as ['coffeeshop']
	names: { type: Array, required: true },
	account: { type: String, default: '' },
	// Endings already in the main search
	endings: { type: Array, default: () => [] }
})

const emit = defineEmits(['add-ending'])

const BATCH = 20
const CONCURRENCY = 4
const PAGE_SIZE = 100
const MAX_PAGES = 30
const SHOWN = 25
const CURRENCY = /^[A-Z]{3}$/

const headingId = useId()
const { exec } = useCfCommands()
const { copy } = useNotify()
const extensionsCache = useState('cf-domain-search-extensions', () => ({}))

const running = ref(false)
const error = ref('')
const checked = ref([])
const done = ref(0)
const total = ref(0)
const phase = ref('')
const showAll = ref(false)
let token = 0

const loadExtensions = async (account, { fresh }) => {
	const key = account || 'default'
	if (!fresh && extensionsCache.value[key]) return extensionsCache.value[key]
	const names = []
	let cursor = ''
	for (let page = 0; page < MAX_PAGES; page++) {
		const response = await exec(
			'registrar extensions list',
			{ account: account || undefined, flags: { 'per-page': PAGE_SIZE, cursor: cursor || undefined } },
			{ fallback: 'Cloudflare Registrar didn’t list its endings' }
		)
		for (const item of response?.result || []) {
			if (typeof item?.metadata?.name === 'string') names.push(item.metadata.name.toLowerCase())
		}
		cursor = response?.result_info?.cursor || ''
		if (!cursor) break
	}
	extensionsCache.value[key] = [...new Set(names)].sort()
	return extensionsCache.value[key]
}

const run = async ({ fresh = false } = {}) => {
	const current = ++token
	running.value = true
	error.value = ''
	checked.value = []
	done.value = 0
	total.value = 0
	showAll.value = false
	phase.value = 'endings'
	try {
		const extensions = await loadExtensions(props.account, { fresh })
		if (current !== token) return
		const domains = props.names.flatMap((name) => extensions.map((extension) => `${name}.${extension}`))
		const batches = []
		for (let index = 0; index < domains.length; index += BATCH) batches.push(domains.slice(index, index + BATCH))
		total.value = domains.length
		phase.value = 'checking'

		const found = []
		let failure = null
		let next = 0
		const worker = async () => {
			while (next < batches.length && current === token) {
				const batch = batches[next++]
				try {
					const response = await exec(
						'registrar registrations check',
						{ account: props.account || undefined, body: { domains: batch } },
						{ fallback: 'Cloudflare Registrar didn’t answer' }
					)
					found.push(...(response?.result?.domains || []).filter((item) => typeof item?.name === 'string'))
				} catch (reason) {
					failure ??= reason
				} finally {
					done.value += batch.length
				}
			}
		}
		await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker))
		if (current !== token) return
		checked.value = found
		if (failure) {
			error.value = `Some endings weren’t checked: ${describeError(failure, 'Cloudflare Registrar didn’t answer')}`
		}
	} catch (reason) {
		if (current === token) {
			error.value = `Cloudflare Registrar couldn’t check every ending: ${describeError(reason, 'it didn’t answer')}`
		}
	} finally {
		if (current === token) running.value = false
	}
}

watch(
	() => [props.names.join(','), props.account],
	() => run(),
	{ immediate: true }
)

const quoteOf = (item) =>
	item.registrable === true &&
	item.tier === 'standard' &&
	CURRENCY.test(item.pricing?.currency || '') &&
	Number.isFinite(Number(item.pricing?.registration_cost))

const available = computed(() =>
	checked.value
		.filter(quoteOf)
		.sort((a, b) => Number(a.pricing.registration_cost) - Number(b.pricing.registration_cost))
)
const visible = computed(() => (showAll.value ? available.value : available.value.slice(0, SHOWN)))

const summary = computed(
	() =>
		`Cloudflare can register ${formatNumber(available.value.length)} of the ${plural(checked.value.length, 'name')} it checked, cheapest first.`
)

const progressLabel = computed(() =>
	phase.value === 'endings'
		? 'Asking Cloudflare Registrar which endings it sells…'
		: `Checked ${formatNumber(done.value)} of ${formatNumber(total.value)} names with Cloudflare Registrar…`
)

const renewalNote = (item) =>
	Number(item.pricing.renewal_cost) && Number(item.pricing.renewal_cost) !== Number(item.pricing.registration_cost)
		? `Renews at ${formatMoney(item.pricing.renewal_cost, item.pricing.currency)}`
		: ''

// "brand.co.uk" → "co.uk"
const endingOf = (name) => name.split('.').slice(1).join('.')
</script>
