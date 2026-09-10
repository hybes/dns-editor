<template>
	<PageContainer>
		<Head>
			<Title>Domain Search</Title>
		</Head>

		<section aria-labelledby="domain-search-title" class="mx-auto flex w-full max-w-5xl flex-col gap-6">
			<UButton to="/zones" variant="ghost" color="neutral" icon="i-clarity-undo-line" class="self-start">
				Back to Zones
			</UButton>

			<header>
				<p class="text-primary text-xs font-semibold tracking-wide uppercase">Tools</p>
				<h1
					id="domain-search-title"
					class="text-highlighted mt-1 text-2xl font-semibold tracking-tight sm:text-3xl"
				>
					Domain Search
				</h1>
				<p class="text-muted mt-2 max-w-2xl text-sm">
					Check whether a name is still free, see an indicative price, and open a registrar to buy it.
					Availability comes straight from each registry’s RDAP service.
				</p>
			</header>

			<form class="surface-panel flex flex-col gap-5 p-4 sm:p-6" @submit.prevent="runSearch()">
				<UFormField
					label="Name to check"
					name="domain-query"
					:error="inputError || undefined"
					help="Type a bare name to check it across the endings below, or a full domain to check that exact name as well."
				>
					<div class="flex flex-col gap-2 sm:flex-row">
						<UInput
							id="domain-query"
							v-model="query"
							size="lg"
							icon="i-heroicons-magnifying-glass-20-solid"
							placeholder="myproject or myproject.dev"
							autocomplete="off"
							autocapitalize="off"
							:spellcheck="false"
							class="w-full"
						/>
						<UButton
							type="submit"
							color="primary"
							size="lg"
							icon="i-heroicons-magnifying-glass-20-solid"
							:loading="loading"
							:disabled="!query.trim()"
							class="shrink-0"
						>
							Search
						</UButton>
					</div>
				</UFormField>

				<div>
					<div class="flex items-center justify-between gap-3">
						<p class="text-highlighted text-sm font-medium">Domain endings to check</p>
						<span class="text-muted text-xs tabular-nums">{{ selectedTlds.length }} selected</span>
					</div>
					<div class="mt-2 flex flex-wrap gap-2" role="group" aria-label="Domain endings">
						<UButton
							v-for="tld in tldOptions"
							:key="tld"
							size="sm"
							:variant="selectedTlds.includes(tld) ? 'soft' : 'outline'"
							:color="selectedTlds.includes(tld) ? 'primary' : 'neutral'"
							:aria-pressed="selectedTlds.includes(tld)"
							class="font-mono"
							@click="toggleTld(tld)"
						>
							.{{ tld }}
						</UButton>
					</div>
					<div class="mt-3 flex max-w-sm items-start gap-2">
						<UFormField
							label="Add another ending"
							name="custom-tld"
							:error="tldError || undefined"
							class="flex-1"
						>
							<UInput
								v-model="customTld"
								placeholder="e.g. co.nz"
								size="sm"
								autocomplete="off"
								:spellcheck="false"
								class="w-full font-mono"
								@keydown.enter.prevent="addCustomTld"
							/>
						</UFormField>
						<UButton
							size="sm"
							variant="outline"
							color="neutral"
							icon="i-heroicons-plus-20-solid"
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
				color="error"
				variant="subtle"
				icon="i-heroicons-exclamation-triangle"
				title="Search Failed"
				:description="error"
			/>

			<template v-if="result">
				<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-live="polite">
					<p class="text-muted">
						<span class="tabular-nums">{{ result.results.length }}</span> names checked for
						<span class="text-highlighted font-mono">{{ result.base }}</span>
					</p>
					<p v-if="result.reducedFrom" class="text-muted text-xs">
						Registries only track registrable names, so {{ result.reducedFrom }} was checked as
						{{ result.exact }}.
					</p>
					<p v-if="result.truncated" class="text-warning text-xs">
						Only the first {{ result.results.length }} endings were checked.
					</p>
					<p v-if="result.pricing" class="text-dimmed text-xs sm:ml-auto">
						Prices are {{ result.pricing.source }}’s first-year registration price in
						{{ result.pricing.currency }}, for reference only.
					</p>
				</div>

				<ul class="surface-panel divide-default divide-y overflow-hidden">
					<li
						v-for="item in result.results"
						:key="item.domain"
						class="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
					>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-highlighted font-mono text-base font-semibold break-all">
									{{ item.domain }}
								</span>
								<UBadge
									:color="availabilityMeta(item).color"
									variant="subtle"
									:icon="availabilityMeta(item).icon"
								>
									{{ availabilityMeta(item).label }}
								</UBadge>
								<UBadge
									v-if="ownedZones[item.domain]"
									color="info"
									variant="subtle"
									icon="i-heroicons-cloud"
								>
									In your Cloudflare account
								</UBadge>
							</div>
							<p class="text-muted mt-1 text-xs">{{ detailLine(item) }}</p>
						</div>

						<div class="text-sm sm:w-36 sm:shrink-0 sm:text-right">
							<template v-if="item.price && item.availability !== 'registered'">
								<p class="text-highlighted font-semibold tabular-nums">
									{{ money(item.price.registration, item.price.currency) }}
									<span class="text-muted text-xs font-normal">/yr</span>
								</p>
								<p
									v-if="item.price.renewal !== null && item.price.renewal !== item.price.registration"
									class="text-dimmed text-xs tabular-nums"
								>
									renews at {{ money(item.price.renewal, item.price.currency) }}
								</p>
							</template>
						</div>

						<div class="flex shrink-0 flex-wrap gap-2">
							<UDropdownMenu
								v-if="item.availability === 'available' || item.availability === 'maybe'"
								:items="buyItems(item)"
								:content="{ align: 'end' }"
							>
								<UButton
									color="primary"
									icon="i-heroicons-shopping-cart"
									trailing-icon="i-heroicons-chevron-down-20-solid"
								>
									Buy
								</UButton>
							</UDropdownMenu>
							<UButton
								v-if="ownedZones[item.domain]"
								:to="`/zones/${ownedZones[item.domain]}/records`"
								variant="soft"
								color="neutral"
								icon="i-heroicons-pencil-square"
							>
								Manage Records
							</UButton>
							<UButton
								v-else-if="item.availability !== 'available'"
								:to="{ path: '/tools/dns-lookup', query: { name: item.domain, type: 'ALL' } }"
								variant="outline"
								color="neutral"
								icon="i-heroicons-globe-alt"
							>
								Look Up DNS
							</UButton>
						</div>
					</li>
				</ul>

				<p class="text-dimmed text-xs">
					Registries can lag behind live registrations and some publish no RDAP at all, so the registrar’s
					checkout has the final say. Cloudflare’s register page has no pre-filled search, so the name is
					copied to your clipboard when you choose it.
				</p>
			</template>

			<div v-else-if="!loading && !error" class="surface-panel flex flex-col items-center px-6 py-12 text-center">
				<div class="bg-muted mb-3 flex h-12 w-12 items-center justify-center rounded-full">
					<UIcon name="i-heroicons-shopping-cart" class="text-muted h-6 w-6" aria-hidden="true" />
				</div>
				<h2 class="text-highlighted font-semibold">Search for a name</h2>
				<p class="text-muted mt-1 max-w-md text-sm">
					Results show which endings are still free, who holds the taken ones, and where to buy.
				</p>
			</div>
		</section>
	</PageContainer>
</template>

<script setup>
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { getApiKey } = useSession()

const DEFAULT_TLDS = ['com', 'net', 'org', 'io', 'co', 'dev', 'app', 'ai', 'uk', 'co.uk', 'me', 'xyz']
const MAX_TLDS = 15
const TLD_PATTERN = /^(?:[a-z]{2,63}|xn--[a-z0-9-]+)(?:\.[a-z]{2,63})?$/

const queryString = (value) => (typeof value === 'string' ? value : '')

const query = ref(queryString(route.query.q))
const selectedTlds = ref([...DEFAULT_TLDS])
const customTlds = ref([])
const customTld = ref('')
const tldError = ref('')
const inputError = ref('')
const loading = ref(false)
const error = ref('')
const result = ref(null)
const ownedZones = ref({})

const tldOptions = computed(() => [...DEFAULT_TLDS, ...customTlds.value.filter((t) => !DEFAULT_TLDS.includes(t))])

const AVAILABILITY = {
	available: { label: 'Available', color: 'success', icon: 'i-heroicons-check-circle-20-solid' },
	registered: { label: 'Registered', color: 'neutral', icon: 'i-heroicons-lock-closed-20-solid' },
	maybe: { label: 'Possibly available', color: 'warning', icon: 'i-heroicons-question-mark-circle-20-solid' },
	unknown: { label: 'Unknown', color: 'error', icon: 'i-heroicons-exclamation-circle-20-solid' }
}

const availabilityMeta = (item) => AVAILABILITY[item.availability] || AVAILABILITY.unknown

const formatDate = (iso) => {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return ''
	return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const money = (amount, currency = 'USD') => {
	if (amount === null || amount === undefined) return ''
	try {
		return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
	} catch {
		return `${amount} ${currency}`
	}
}

const detailLine = (item) => {
	if (item.availability === 'registered' && item.source === 'registry') {
		const parts = [`Registered with ${item.registrar || 'an undisclosed registrar'}`]
		if (item.registered) parts.push(`since ${formatDate(item.registered)}`)
		if (item.expires) parts.push(`expires ${formatDate(item.expires)}`)
		return parts.join(' · ')
	}
	return item.reason || ''
}

const copyDomain = async (domain) => {
	try {
		await navigator.clipboard.writeText(domain)
		toast.add({
			id: 'copy-domain' + Date.now(),
			title: 'Copied',
			description: `${domain} copied. Paste it into the registrar’s search.`,
			icon: 'i-clarity-check-circle-solid',
			color: 'success',
			duration: 3000
		})
	} catch {
		// The registrar page still opens; the user can type the name.
	}
}

const buyItems = (item) => [
	[
		{
			label: 'Cloudflare Registrar',
			icon: 'i-heroicons-cloud',
			to: item.links.cloudflare,
			target: '_blank',
			onSelect: () => copyDomain(item.domain)
		},
		{
			label: 'Porkbun',
			icon: 'i-heroicons-arrow-top-right-on-square-20-solid',
			to: item.links.porkbun,
			target: '_blank'
		},
		{
			label: 'Namecheap',
			icon: 'i-heroicons-arrow-top-right-on-square-20-solid',
			to: item.links.namecheap,
			target: '_blank'
		}
	]
]

const persistTlds = () => {
	localStorage.setItem(
		STORAGE_KEYS.domainSearchTlds,
		JSON.stringify({ selected: selectedTlds.value, custom: customTlds.value })
	)
}

const restoreTlds = () => {
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.domainSearchTlds) || 'null')
		if (!parsed || typeof parsed !== 'object') return
		const clean = (list) =>
			Array.isArray(list) ? list.filter((t) => typeof t === 'string' && TLD_PATTERN.test(t)) : null
		const custom = clean(parsed.custom)
		const selected = clean(parsed.selected)
		if (custom) customTlds.value = custom
		if (selected) selectedTlds.value = selected
	} catch {
		// Ignore a corrupt preference and fall back to the defaults.
	}
}

const toggleTld = (tld) => {
	if (selectedTlds.value.includes(tld)) {
		selectedTlds.value = selectedTlds.value.filter((t) => t !== tld)
	} else if (selectedTlds.value.length >= MAX_TLDS) {
		tldError.value = `You can check up to ${MAX_TLDS} endings at once.`
		return
	} else {
		selectedTlds.value = [...selectedTlds.value, tld]
	}
	tldError.value = ''
	persistTlds()
}

const addCustomTld = () => {
	const tld = customTld.value.trim().toLowerCase().replace(/^\.+/, '')
	if (!tld) return
	if (!TLD_PATTERN.test(tld)) {
		tldError.value = `“.${tld}” is not a valid domain ending.`
		return
	}
	if (!tldOptions.value.includes(tld)) customTlds.value = [...customTlds.value, tld]
	if (!selectedTlds.value.includes(tld)) {
		if (selectedTlds.value.length >= MAX_TLDS) {
			tldError.value = `You can check up to ${MAX_TLDS} endings at once.`
			return
		}
		selectedTlds.value = [...selectedTlds.value, tld]
	}
	tldError.value = ''
	customTld.value = ''
	persistTlds()
}

const loadOwnedZones = async (apiKey) => {
	try {
		const data = await $fetch('/api/zones', { method: 'POST', body: { apiKey } })
		const map = {}
		for (const zone of data?.result || []) {
			if (zone?.name && zone?.id) map[zone.name.toLowerCase()] = zone.id
		}
		ownedZones.value = map
	} catch {
		ownedZones.value = {}
	}
}

const runSearch = async () => {
	const trimmed = query.value.trim()
	inputError.value = ''
	if (!trimmed) {
		inputError.value = 'Enter a name to search for.'
		return
	}
	if (!trimmed.includes('.') && !selectedTlds.value.length) {
		inputError.value = 'Choose at least one domain ending, or include one in the name.'
		return
	}

	loading.value = true
	error.value = ''
	try {
		const data = await $fetch('/api/domain_search', {
			method: 'POST',
			body: { query: trimmed, tlds: selectedTlds.value }
		})
		if (!data?.success) throw new Error(data?.errors?.[0]?.message || 'Search failed')
		result.value = data.result
		router.replace({ query: { ...route.query, q: trimmed } })
	} catch (e) {
		result.value = null
		const message = e?.data?.statusMessage || e?.statusMessage || e?.message || 'Search failed'
		if (e?.statusCode === 400 || e?.data?.statusCode === 400) inputError.value = message
		else error.value = message
	} finally {
		loading.value = false
	}
}

watch(query, () => {
	if (inputError.value) inputError.value = ''
})

onMounted(() => {
	restoreTlds()
	const apiKey = getApiKey()
	if (apiKey) loadOwnedZones(apiKey)
	if (query.value.trim()) runSearch()
})
</script>
