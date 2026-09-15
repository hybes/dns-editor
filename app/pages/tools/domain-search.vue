<template>
	<UDashboardPanel id="tool-domain-search">
		<template #header>
			<UDashboardNavbar title="Domain Search">
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<p role="status" class="sr-only">{{ announcement }}</p>

			<form class="flex flex-col gap-4" novalidate @submit.prevent="submitSearch">
				<p class="text-muted text-sm">
					Check which endings of a name are still free with each registry’s RDAP service, then open a
					registrar to buy one.
				</p>

				<div class="flex flex-col gap-3 sm:flex-row sm:items-start">
					<UFormField
						label="Name to check"
						:error="inputError || undefined"
						help="Include an ending, such as myproject.dev, to check that exact name as well."
						class="flex-1"
					>
						<UInput
							ref="nameInput"
							v-model="query"
							icon="i-lucide-search"
							placeholder="myproject or myproject.dev"
							autocomplete="off"
							autocapitalize="off"
							:spellcheck="false"
							class="w-full"
							@update:model-value="inputError = ''"
						/>
					</UFormField>
					<UButton type="submit" icon="i-lucide-search" :loading="loading" class="justify-center sm:mt-6">
						Search
					</UButton>
				</div>

				<div role="group" aria-labelledby="endings-label" class="flex flex-col gap-2">
					<p id="endings-label" class="text-default text-sm font-medium">
						Endings to check
						<span class="text-muted font-normal tabular-nums">
							({{ selectedTlds.length }} selected, up to {{ MAX_TLDS }})
						</span>
					</p>
					<div class="flex flex-wrap items-center gap-1.5">
						<UButton
							v-for="tld in tldOptions"
							:key="tld"
							size="xs"
							:variant="selectedTlds.includes(tld) ? 'soft' : 'outline'"
							:color="selectedTlds.includes(tld) ? 'primary' : 'neutral'"
							:icon="selectedTlds.includes(tld) ? 'i-lucide-check' : undefined"
							:aria-pressed="selectedTlds.includes(tld)"
							class="font-mono"
							@click="toggleTld(tld)"
						>
							.{{ tld }}
						</UButton>
					</div>
					<div class="flex max-w-sm items-start gap-2">
						<UFormField label="Add an ending" :error="tldError || undefined" class="flex-1">
							<UInput
								v-model="customTld"
								placeholder="co.nz"
								size="sm"
								autocomplete="off"
								autocapitalize="off"
								:spellcheck="false"
								class="w-full"
								:ui="{ base: 'font-mono' }"
								@update:model-value="tldError = ''"
								@keydown.enter.prevent="addCustomTld"
							/>
						</UFormField>
						<UButton
							size="sm"
							variant="outline"
							color="neutral"
							icon="i-lucide-plus"
							class="mt-6"
							@click="addCustomTld"
						>
							Add
						</UButton>
					</div>
				</div>
			</form>

			<UAlert
				v-if="error"
				role="alert"
				color="error"
				variant="subtle"
				icon="i-lucide-circle-alert"
				title="Search failed"
				:description="error"
				:actions="[
					{
						label: 'Try again',
						icon: 'i-lucide-refresh-cw',
						color: 'neutral',
						variant: 'outline',
						onClick: retry
					}
				]"
			/>

			<p v-if="loading" class="text-muted flex items-center gap-2 text-sm">
				<UIcon
					name="i-lucide-loader-circle"
					class="size-4 shrink-0 animate-spin motion-reduce:animate-none"
					aria-hidden="true"
				/>
				Asking each registry whether these names are free. A slow registry can hold this up for several seconds.
			</p>

			<section
				v-if="result"
				aria-labelledby="domain-results-heading"
				:aria-busy="loading"
				class="flex flex-col gap-3 transition-opacity"
				:class="{ 'opacity-50': loading }"
			>
				<header class="flex flex-wrap items-start gap-x-4 gap-y-2">
					<div class="min-w-0 flex-1">
						<h2 id="domain-results-heading" class="text-highlighted text-base font-semibold">
							Results for <span class="font-mono">{{ result.base }}</span>
						</h2>
						<p class="text-muted mt-0.5 text-sm tabular-nums">{{ countsLabel }}</p>
						<p v-if="result.reducedFrom" class="text-muted mt-0.5 text-sm">
							Registries only track registrable names, so {{ result.reducedFrom }} was checked as
							{{ result.exact || result.base }}.
						</p>
					</div>
					<UButton
						size="sm"
						variant="outline"
						color="neutral"
						icon="i-lucide-copy"
						@click="copy(JSON.stringify(result, null, 2), 'Search result JSON')"
					>
						Copy JSON
					</UButton>
				</header>

				<ul class="divide-default border-default divide-y border-y">
					<li
						v-for="item in result.results"
						:key="item.domain"
						class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4"
					>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-highlighted font-mono text-sm font-semibold break-all">
									{{ item.domain }}
								</span>
								<UBadge
									:color="availabilityMeta(item).color"
									:icon="availabilityMeta(item).icon"
									variant="subtle"
									size="sm"
								>
									{{ availabilityMeta(item).label }}
								</UBadge>
								<UBadge
									v-if="ownedZoneId(item.domain)"
									color="info"
									variant="subtle"
									size="sm"
									icon="i-lucide-cloud"
								>
									In your Cloudflare account
								</UBadge>
							</div>
							<p class="text-muted mt-1 text-xs">
								<template v-if="item.availability === 'registered' && item.source === 'registry'">
									Registered with {{ item.registrar || 'an undisclosed registrar' }}
									<template v-if="validDate(item.registered)">
										· since
										<time :datetime="item.registered">{{ formatDate(item.registered) }}</time>
									</template>
									<template v-if="validDate(item.expires)">
										· expires
										<time :datetime="item.expires">{{ formatDate(item.expires) }}</time>
									</template>
								</template>
								<template v-else>{{ item.reason }}</template>
							</p>
						</div>

						<div
							v-if="item.price && item.availability !== 'registered'"
							class="text-sm md:w-36 md:shrink-0 md:text-right"
						>
							<p class="text-highlighted font-medium tabular-nums">
								{{ money(item.price.registration, item.price.currency) }}
								<span class="text-muted text-xs font-normal">first year</span>
							</p>
							<p
								v-if="item.price.renewal !== null && item.price.renewal !== item.price.registration"
								class="text-dimmed text-xs tabular-nums"
							>
								Renews at {{ money(item.price.renewal, item.price.currency) }}
							</p>
						</div>

						<div class="flex shrink-0 flex-wrap items-center gap-1.5">
							<UDropdownMenu
								v-if="item.availability === 'available' || item.availability === 'maybe'"
								:items="buyItems(item)"
								:content="{ align: 'end' }"
							>
								<UButton
									size="sm"
									icon="i-lucide-shopping-cart"
									trailing-icon="i-lucide-chevron-down"
									:aria-label="`Buy ${item.domain}`"
								>
									Buy
								</UButton>
							</UDropdownMenu>
							<UButton
								v-if="ownedZoneId(item.domain)"
								size="sm"
								variant="outline"
								color="neutral"
								icon="i-lucide-list"
								:to="`/zones/${ownedZoneId(item.domain)}/records`"
								:aria-label="`Manage records for ${item.domain}`"
							>
								Manage records
							</UButton>
							<UButton
								v-else-if="item.availability !== 'available'"
								size="sm"
								variant="outline"
								color="neutral"
								icon="i-lucide-text-search"
								:to="{ path: '/tools/dns-lookup', query: { name: item.domain, type: 'ALL' } }"
								:aria-label="`Look up DNS for ${item.domain}`"
							>
								Look up DNS
							</UButton>
							<UButton
								size="sm"
								variant="ghost"
								color="neutral"
								icon="i-lucide-copy"
								:aria-label="`Copy ${item.domain}`"
								@click="copy(item.domain, item.domain)"
							/>
						</div>
					</li>
				</ul>

				<p class="text-dimmed text-xs">
					<template v-if="result.pricing">
						Prices are {{ result.pricing.source }}’s registration prices in {{ result.pricing.currency }},
						for reference only.
					</template>
					Registries can lag behind new registrations and some publish no RDAP, so the registrar’s checkout
					has the final say. Cloudflare’s register page can’t be pre-filled, so choosing it copies the name
					for you to paste.
				</p>
			</section>
		</template>
	</UDashboardPanel>
</template>

<script setup>
const route = useRoute()
const router = useRouter()
const { call } = useCfApi()
const { copy } = useNotify()
const { zones, load: loadZones } = useZones()

const DEFAULT_TLDS = ['com', 'net', 'org', 'io', 'co', 'dev', 'app', 'ai', 'uk', 'co.uk', 'me', 'xyz']
// Mirrors MAX_TLDS in server/api/domain_search.post.js, which refuses longer lists.
const MAX_TLDS = 15
const TLD_PATTERN = /^(?:[a-z]{2,63}|xn--[a-z0-9-]+)(?:\.[a-z]{2,63})?$/

const AVAILABILITY = {
	available: { label: 'Available', color: 'success', icon: 'i-lucide-circle-check' },
	registered: { label: 'Registered', color: 'neutral', icon: 'i-lucide-lock' },
	maybe: { label: 'Possibly available', color: 'warning', icon: 'i-lucide-circle-help' },
	unknown: { label: 'Unknown', color: 'error', icon: 'i-lucide-circle-alert' }
}

const queryString = (value) => (typeof value === 'string' ? value : '')

const nameInput = useTemplateRef('nameInput')
const query = ref('')
const selectedTlds = ref([...DEFAULT_TLDS])
const customTlds = ref([])
const customTld = ref('')
const tldError = ref('')
const inputError = ref('')
const loading = ref(false)
const error = ref('')
const result = ref(null)
const lastParams = ref(null)
const announcement = ref('')

let requestId = 0
// The search term last read from or written to ?q=, so the watcher ignores this page's own
// router.replace and reacts only to navigation.
let routeTerm = null

useSeoMeta({ title: () => (result.value ? `${result.value.base} · Domain Search` : 'Domain Search') })

const tldOptions = computed(() => [...DEFAULT_TLDS, ...customTlds.value.filter((t) => !DEFAULT_TLDS.includes(t))])

const ownedZones = computed(() => new Map(zones.value.map((zone) => [zone.name.toLowerCase(), zone.id])))
const ownedZoneId = (domain) => ownedZones.value.get(domain) || ''

const availabilityMeta = (item) => AVAILABILITY[item.availability] || AVAILABILITY.unknown

const countsLabel = computed(() => {
	if (!result.value) return ''
	const counts = { available: 0, maybe: 0, registered: 0, unknown: 0 }
	for (const item of result.value.results) {
		counts[item.availability in counts ? item.availability : 'unknown']++
	}
	return Object.entries(counts)
		.filter(([key, count]) => count || key === 'available')
		.map(([key, count]) => `${count} ${AVAILABILITY[key].label.toLowerCase()}`)
		.join(' · ')
})

const validDate = (iso) => Boolean(iso) && !Number.isNaN(new Date(iso).getTime())

const formatDate = (iso) =>
	new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

const money = (amount, currency = 'USD') => {
	if (amount === null || amount === undefined) return ''
	try {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
	} catch {
		return `${amount} ${currency}`
	}
}

const buyItems = (item) => [
	[
		{
			label: 'Cloudflare Registrar',
			icon: 'i-lucide-cloud',
			to: item.links.cloudflare,
			target: '_blank',
			// The register page has no search parameter, so the name goes on the clipboard.
			onSelect: () => copy(item.domain, item.domain)
		},
		{ label: 'Porkbun', icon: 'i-lucide-external-link', to: item.links.porkbun, target: '_blank' },
		{ label: 'Namecheap', icon: 'i-lucide-external-link', to: item.links.namecheap, target: '_blank' }
	]
]

const persistTlds = () => {
	try {
		localStorage.setItem(
			STORAGE_KEYS.domainSearchTlds,
			JSON.stringify({ selected: selectedTlds.value, custom: customTlds.value })
		)
	} catch {
		// The selection still applies to this visit; it just won't be remembered.
	}
}

const restoreTlds = () => {
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.domainSearchTlds) || 'null')
		if (!parsed || typeof parsed !== 'object') return
		const clean = (list) =>
			Array.isArray(list) ? [...new Set(list.filter((t) => typeof t === 'string' && TLD_PATTERN.test(t)))] : null
		const custom = clean(parsed.custom)
		const selected = clean(parsed.selected)
		if (custom) customTlds.value = custom
		if (selected) selectedTlds.value = selected.slice(0, MAX_TLDS)
	} catch {
		// Ignore a corrupt preference and fall back to the defaults.
	}
}

// The error sits under "Add an ending" even when an ending button caused it, so it is
// also spoken: someone who pressed a button would otherwise hear nothing.
const showTldError = (message) => {
	tldError.value = message
	announcement.value = message
}

const toggleTld = (tld) => {
	if (selectedTlds.value.includes(tld)) {
		selectedTlds.value = selectedTlds.value.filter((t) => t !== tld)
	} else if (selectedTlds.value.length >= MAX_TLDS) {
		showTldError(`You can check up to ${MAX_TLDS} endings at once. Deselect one first.`)
		return
	} else {
		selectedTlds.value = [...selectedTlds.value, tld]
	}
	tldError.value = ''
	persistTlds()
}

const addCustomTld = () => {
	const tld = customTld.value.trim().toLowerCase().replace(/^\.+/, '')
	if (!tld) {
		showTldError('Type an ending, such as co.nz.')
		return
	}
	if (!TLD_PATTERN.test(tld)) {
		showTldError(`“.${tld}” is not a valid domain ending.`)
		return
	}
	if (!selectedTlds.value.includes(tld) && selectedTlds.value.length >= MAX_TLDS) {
		showTldError(`You can check up to ${MAX_TLDS} endings at once. Deselect one first.`)
		return
	}
	if (!tldOptions.value.includes(tld)) customTlds.value = [...customTlds.value, tld]
	if (!selectedTlds.value.includes(tld)) selectedTlds.value = [...selectedTlds.value, tld]
	tldError.value = ''
	customTld.value = ''
	persistTlds()
}

const runSearch = async (params) => {
	const id = ++requestId
	loading.value = true
	error.value = ''
	inputError.value = ''
	announcement.value = ''
	lastParams.value = params
	try {
		const data = await call('domain_search', params, { auth: false, fallback: 'The domain search failed' })
		if (id !== requestId) return
		result.value = data.result
		announcement.value = `Search finished for ${data.result.base}: ${countsLabel.value}.`
	} catch (e) {
		if (id !== requestId) return
		const message = describeError(e, 'The domain search failed')
		result.value = null
		// The alert announces other failures itself; a field error has no live region.
		if (isInputError(e)) {
			inputError.value = message
			announcement.value = `Search failed: ${message}`
		} else {
			error.value = message
		}
	} finally {
		if (id === requestId) loading.value = false
	}
}

// Focusing the field reads its error, which is linked to it, to screen reader users.
const focusNameInput = () => nextTick(() => nameInput.value?.inputRef?.focus())

const submitSearch = () => {
	const trimmed = query.value.trim()
	inputError.value = ''
	if (!trimmed) {
		inputError.value = 'Enter a name to search for.'
		focusNameInput()
		return
	}
	if (!trimmed.includes('.') && !selectedTlds.value.length) {
		inputError.value = 'Choose at least one ending below, or include one in the name.'
		focusNameInput()
		return
	}
	routeTerm = trimmed
	router.replace({ query: { ...route.query, q: trimmed } })
	runSearch({ query: trimmed, tlds: [...selectedTlds.value] })
}

const retry = () => {
	if (lastParams.value) runSearch(lastParams.value)
}

// The saved endings must be in place before a ?q= link starts the first search.
restoreTlds()

watch(
	() => route.query.q,
	(value) => {
		const incoming = queryString(value).trim()
		if (incoming === routeTerm) return
		routeTerm = incoming

		requestId++
		loading.value = false
		error.value = ''
		inputError.value = ''
		query.value = incoming

		if (!incoming) {
			result.value = null
			announcement.value = ''
			return
		}
		runSearch({ query: incoming, tlds: [...selectedTlds.value] })
	},
	{ immediate: true }
)

onMounted(() => {
	loadZones()
})
</script>
