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

			<form class="flex flex-col gap-5" novalidate @submit.prevent="submitSearch">
				<p class="text-muted text-sm">
					Check which endings of a name are still free with each registry’s RDAP service and, if you like,
					Cloudflare Registrar, which also suggests names. Then register one with Cloudflare here or buy it
					from another registrar.
				</p>

				<div class="flex flex-col gap-3 sm:flex-row sm:items-start">
					<UFormField
						label="Names to check"
						:error="inputError || undefined"
						help="Separate names with commas to compare them. Include an ending, such as myproject.dev, to check that exact name too."
						class="flex-1"
					>
						<UInput
							ref="nameInput"
							v-model="query"
							icon="i-lucide-search"
							placeholder="myproject, my project, myproject.dev"
							autocomplete="off"
							autocapitalize="off"
							:spellcheck="false"
							class="w-full"
							@update:model-value="inputError = ''"
						/>
					</UFormField>
					<div class="flex flex-col gap-2 sm:mt-6 sm:flex-row">
						<UButton type="submit" icon="i-lucide-search" :loading="loading" class="justify-center">
							Search
						</UButton>
						<UButton
							v-if="cfEnabled"
							icon="i-lucide-list-checks"
							color="neutral"
							variant="outline"
							class="justify-center"
							@click="checkEveryEnding"
						>
							Check every ending
						</UButton>
					</div>
				</div>

				<DomainSearchEndingPicker
					v-model="selectedTlds"
					v-model:custom="customTlds"
					:max="MAX_TLDS"
					@update:model-value="persistTlds"
					@update:custom="persistTlds"
					@error="(message) => (announcement = message)"
				/>

				<DomainSearchVariations
					v-model:enabled="variationsEnabled"
					v-model:selected="selectedVariations"
					:name="firstLabel"
				/>

				<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
					<USwitch
						v-model="cfEnabled"
						label="Check with Cloudflare Registrar"
						description="Adds Cloudflare’s live price for each name, whether it can be registered here, and names Cloudflare suggests."
						class="sm:flex-1"
					/>
					<UFormField
						v-if="cfEnabled && cfPickAccount"
						label="Account"
						name="domain-search-account"
						class="sm:w-72"
						:error="cfAccountMissing ? 'Choose the account to check prices for' : false"
					>
						<USelectMenu
							v-model="cfAccountId"
							:items="cfAccountItems"
							value-key="value"
							:search-input="cfAccountItems.length > 8 ? { placeholder: 'Find an account…' } : false"
							placeholder="Choose an account"
							icon="i-lucide-building-2"
							size="sm"
							class="w-full"
						/>
					</UFormField>
				</div>

				<p v-if="plannedCount" class="text-sm tabular-nums" :class="overLimit ? 'text-error' : 'text-muted'">
					{{ plannedLabel }}
				</p>
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
							Results for <span class="font-mono">{{ resultTitle }}</span>
						</h2>
						<p class="text-muted mt-0.5 text-sm tabular-nums">{{ countsLabel }}</p>
						<p v-for="base in reducedBases" :key="base.query" class="text-muted mt-0.5 text-sm">
							Registries only track registrable names, so {{ base.reducedFrom }} was checked as
							{{ base.exact || base.base }}.
						</p>
						<p v-if="cfEnabled && cfChecking" class="text-muted mt-1 flex items-center gap-1.5 text-xs">
							<UIcon
								name="i-lucide-loader-circle"
								class="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
								aria-hidden="true"
							/>
							Checking prices with Cloudflare Registrar…
						</p>
						<p v-else-if="cfEnabled && cfError" class="text-muted mt-1 flex items-start gap-1.5 text-xs">
							<UIcon name="i-lucide-cloud-off" class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
							<span>
								Cloudflare Registrar didn’t check these names: {{ cfError }}
								<UButton
									label="Try again"
									size="xs"
									color="neutral"
									variant="link"
									class="p-0 align-baseline"
									@click="runCloudflareCheck"
								/>
							</span>
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

				<div class="flex flex-wrap items-end gap-3">
					<UFormField label="Show" name="domain-results-show" class="w-full sm:w-56">
						<USelect v-model="show" :items="showItems" size="sm" class="w-full" />
					</UFormField>
					<UFormField label="Sort by" name="domain-results-sort" class="w-full sm:w-56">
						<USelect v-model="sortBy" :items="SORT_ITEMS" size="sm" class="w-full" />
					</UFormField>
					<p v-if="show !== 'all'" class="text-muted pb-1.5 text-sm tabular-nums" aria-live="polite">
						Showing {{ formatNumber(visibleCount) }} of {{ formatNumber(result.results.length) }}
					</p>
				</div>

				<UEmpty
					v-if="!visibleCount"
					variant="naked"
					icon="i-lucide-search-x"
					title="No names match"
					:description="`None of these names is ${SHOW_LABELS[show].toLowerCase()}. Try other endings, add variations, or look at Cloudflare’s suggestions below.`"
					:actions="[
						{ label: 'Show all names', color: 'neutral', variant: 'outline', onClick: () => (show = 'all') }
					]"
				/>

				<div v-for="group in groups" :key="group.base" class="flex flex-col gap-1">
					<h3 v-if="group.heading" class="text-highlighted pt-2 font-mono text-sm font-semibold">
						{{ group.heading }}
					</h3>
					<ul class="divide-default border-default divide-y border-y">
						<li
							v-for="item in group.items"
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
								<RegistrarCheckVerdict
									v-if="cfCheck(item)"
									:result="cfCheck(item)"
									:account="cfAccountId"
									label="Cloudflare Registrar:"
									class="text-muted mt-1 text-xs"
								/>
							</div>

							<div
								v-if="cfQuote(item) || showReferencePrice(item)"
								class="flex flex-col gap-1.5 text-sm md:w-44 md:shrink-0 md:text-right"
							>
								<div v-if="cfQuote(item)">
									<p class="text-highlighted font-medium tabular-nums">
										{{ money(cfQuote(item).registration_cost, cfQuote(item).currency) }}
										<span class="text-muted text-xs font-normal">first year</span>
									</p>
									<p class="text-muted text-xs tabular-nums">
										{{ cfRenewalNote(cfQuote(item)) }}
									</p>
								</div>
								<div v-if="showReferencePrice(item)">
									<p
										class="tabular-nums"
										:class="cfQuote(item) ? 'text-muted text-xs' : 'text-highlighted font-medium'"
									>
										{{ money(item.price.registration, item.price.currency) }}
										<span class="text-muted text-xs font-normal">first year</span>
									</p>
									<p class="text-dimmed text-xs tabular-nums">{{ referenceNote(item.price) }}</p>
								</div>
							</div>

							<div class="flex shrink-0 flex-wrap items-center gap-1.5">
								<UButton
									v-if="cfQuote(item)"
									size="sm"
									icon="i-lucide-badge-check"
									:to="registerLink(item)"
									:aria-label="`Register ${item.domain} with Cloudflare`"
								>
									Register with Cloudflare
								</UButton>
								<UDropdownMenu
									v-if="item.availability === 'available' || item.availability === 'maybe'"
									:items="buyItems(item)"
									:content="{ align: 'end' }"
								>
									<UButton
										size="sm"
										icon="i-lucide-shopping-cart"
										trailing-icon="i-lucide-chevron-down"
										:color="cfQuote(item) ? 'neutral' : 'primary'"
										:variant="cfQuote(item) ? 'outline' : 'solid'"
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
				</div>

				<p class="text-dimmed text-xs">
					<template v-if="cfShown">
						Cloudflare quotes are live prices from Cloudflare Registrar for
						{{ cfAccountName ? `the ${cfAccountName} account` : 'your account' }}.
					</template>
					<template v-if="result.pricing">
						{{ result.pricing.source }}’s prices are its registration prices in
						{{ result.pricing.currency }}, for reference only.
					</template>
					Registries can lag behind new registrations and some publish no RDAP, so the registrar’s checkout
					has the final say. Cloudflare’s register page can’t be pre-filled, so choosing it copies the name
					for you to paste.
				</p>
			</section>

			<DomainSearchEveryEnding
				v-if="everyEndingNames.length && cfEnabled && cfReady"
				ref="everyEndingSection"
				:names="everyEndingNames"
				:account="cfAccountId"
				:endings="selectedTlds"
				class="mt-6"
				@add-ending="addEnding"
			/>

			<DomainSearchSuggestions
				v-if="suggestionQuery && cfEnabled && cfReady"
				:query="suggestionQuery"
				:account="cfAccountId"
				:added="baseLabels"
				class="mt-6"
				@add="addName"
			/>
		</template>
	</UDashboardPanel>
</template>

<script setup>
const route = useRoute()
const router = useRouter()
const { call } = useCfApi()
const { exec } = useCfCommands()
const { copy } = useNotify()
const { zones, load: loadZones, findZone } = useZones()
const { accounts, load: loadAccounts, findAccount } = useAccounts()

const DEFAULT_TLDS = ['com', 'net', 'org', 'io', 'co', 'dev', 'app', 'ai', 'uk', 'co.uk', 'me', 'xyz']
// Mirror the limits in server/api/domain_search.post.js, which refuses anything larger.
const MAX_TLDS = 30
const MAX_CANDIDATES = 60
const TLD_PATTERN = /^(?:[a-z]{2,63}|xn--[a-z0-9-]+)(?:\.[a-z]{2,63})?$/
// Cloudflare Registrar's check takes up to 20 names at a time.
const CF_BATCH = 20
const CF_CURRENCY = /^[A-Z]{3}$/

const AVAILABILITY = {
	available: { label: 'Available', color: 'success', icon: 'i-lucide-circle-check' },
	registered: { label: 'Registered', color: 'neutral', icon: 'i-lucide-lock' },
	maybe: { label: 'Possibly available', color: 'warning', icon: 'i-lucide-circle-help' },
	unknown: { label: 'Unknown', color: 'error', icon: 'i-lucide-circle-alert' }
}

const SHOW_LABELS = {
	all: 'All names',
	free: 'Available or possibly available',
	cloudflare: 'Can register with Cloudflare',
	registered: 'Registered'
}
const SORT_ITEMS = [
	{ label: 'Order checked', value: 'checked' },
	{ label: 'Name', value: 'name' },
	{ label: 'Price, lowest first', value: 'price' }
]

const queryString = (value) => (typeof value === 'string' ? value : '')

const nameInput = useTemplateRef('nameInput')
const query = ref('')
const selectedTlds = ref([...DEFAULT_TLDS])
const customTlds = ref([])
const variationsEnabled = ref(false)
const selectedVariations = ref(['get', 'app', 'hq'])
const inputError = ref('')
const loading = ref(false)
const error = ref('')
const result = ref(null)
const lastParams = ref(null)
const announcement = ref('')
const show = ref('all')
const sortBy = ref('checked')

let requestId = 0

// Cloudflare Registrar's authoritative check for the names in the result, for the chosen account.
const cfEnabled = ref(true)
const cfAccountId = ref('')
const cfChecks = ref({})
const cfChecking = ref(false)
const cfError = ref('')
let cfRequestId = 0
// The search text last read from or written to ?q=, so the watcher ignores this page's own
// router.replace and reacts only to navigation.
let routeTerm = null

// --- Names -----------------------------------------------------------------------------------

// Names are separated by commas, semicolons or lines. A phrase keeps its spaces for
// Cloudflare's suggestions, and is checked with them removed ("my project" → myproject).
const entries = computed(() =>
	query.value
		.split(/[,;\n]+/)
		.map((part) => part.trim().replace(/\s+/g, ' '))
		.filter(Boolean)
		.map((phrase) => ({ phrase, name: phrase.replace(/\s/g, '').toLowerCase() }))
)
const baseLabels = computed(() => [...new Set(entries.value.map((entry) => entry.name.split('.')[0]))])
const firstLabel = computed(() => baseLabels.value[0] || '')
const variationNames = computed(() =>
	variationsEnabled.value ? variationsOf(baseLabels.value, selectedVariations.value) : []
)
const namesToCheck = computed(() => [
	...new Set([...entries.value.map((entry) => entry.name), ...variationNames.value])
])

// Roughly what the server will check: every name across the chosen endings, plus any exact
// ending typed in. It refuses more than MAX_CANDIDATES, so the page says so first.
const plannedCount = computed(() => {
	const planned = new Set()
	for (const name of namesToCheck.value) {
		const [label, ...rest] = name.split('.')
		if (rest.length) planned.add(name)
		for (const tld of selectedTlds.value) planned.add(`${label}.${tld}`)
	}
	return planned.size
})
const overLimit = computed(() => plannedCount.value > MAX_CANDIDATES)
const plannedLabel = computed(() => {
	const base = `${plural(namesToCheck.value.length, 'name')} across ${plural(selectedTlds.value.length, 'ending')}: ${plural(plannedCount.value, 'domain')} to check.`
	return overLimit.value
		? `${base} The most at once is ${MAX_CANDIDATES}, so choose fewer names, variations or endings.`
		: base
})

// Cloudflare's suggestions are for the first name as typed, spaces and all ("coffee shop").
const searchedPhrase = ref('')
const suggestionQuery = computed(() => (result.value ? searchedPhrase.value : ''))

// "Check every ending" asks Cloudflare Registrar about each name (up to three) with every
// ending it sells, since checking hundreds of registries directly would take minutes.
const EVERY_ENDING_NAMES = 3
const everyEndingNames = ref([])
const everyEndingSection = useTemplateRef('everyEndingSection')

const checkEveryEnding = async () => {
	if (!entries.value.length) {
		inputError.value = 'Enter a name to check every ending for.'
		focusNameInput()
		return
	}
	everyEndingNames.value = baseLabels.value.slice(0, EVERY_ENDING_NAMES)
	if (!result.value) submitSearch()
	await nextTick()
	everyEndingSection.value?.$el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// An ending picked from the every-ending list joins the main search.
const addEnding = (tld) => {
	if (selectedTlds.value.includes(tld)) return
	if (selectedTlds.value.length >= MAX_TLDS) {
		announcement.value = `You can check up to ${MAX_TLDS} endings at once. Deselect one first.`
		return
	}
	selectedTlds.value = [...selectedTlds.value, tld]
	if (!customTlds.value.includes(tld) && !DEFAULT_TLDS.includes(tld)) customTlds.value = [...customTlds.value, tld]
	persistTlds()
	submitSearch()
}

// A name picked from Cloudflare's suggestions joins the names being compared.
const addName = (label) => {
	if (baseLabels.value.includes(label)) return
	query.value = [query.value.trim(), label].filter(Boolean).join(', ')
	submitSearch()
}

// --- Results -------------------------------------------------------------------------------

useSeoMeta({ title: () => (result.value ? `${result.value.base} · Domain Search` : 'Domain Search') })

const ownedZones = computed(() => new Map(zones.value.map((zone) => [zone.name.toLowerCase(), zone.id])))
const ownedZoneId = (domain) => ownedZones.value.get(domain) || ''

const availabilityMeta = (item) => AVAILABILITY[item.availability] || AVAILABILITY.unknown

const resultTitle = computed(() => {
	const bases = result.value?.bases || []
	if (bases.length <= 1) return result.value?.base || ''
	return bases.length <= 3 ? bases.map((base) => base.base).join(', ') : `${plural(bases.length, 'name')}`
})
const reducedBases = computed(() => (result.value?.bases || []).filter((base) => base.reducedFrom))

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

const showItems = computed(() =>
	Object.entries(SHOW_LABELS)
		.filter(([value]) => value !== 'cloudflare' || cfShown.value)
		.map(([value, label]) => ({ label, value }))
)

const matchesShow = (item) => {
	if (show.value === 'free') return item.availability === 'available' || item.availability === 'maybe'
	if (show.value === 'cloudflare') return Boolean(cfQuote(item))
	if (show.value === 'registered') return item.availability === 'registered'
	return true
}

// Cloudflare's quote when there is one, otherwise the reference price.
const priceOf = (item) => {
	const quote = cfQuote(item)
	const amount = Number(quote ? quote.registration_cost : item.price?.registration)
	return Number.isFinite(amount) ? amount : Infinity
}

const collator = new Intl.Collator(undefined, { numeric: true })
const sorted = computed(() => {
	const list = (result.value?.results || []).filter(matchesShow)
	if (sortBy.value === 'name') return [...list].sort((a, b) => collator.compare(a.domain, b.domain))
	if (sortBy.value === 'price') return [...list].sort((a, b) => priceOf(a) - priceOf(b))
	return list
})
const visibleCount = computed(() => sorted.value.length)

// Several names in checked order read best grouped by name; sorted lists stay flat.
const groups = computed(() => {
	const bases = result.value?.bases || []
	if (bases.length <= 1 || sortBy.value !== 'checked') {
		return sorted.value.length ? [{ base: '', heading: '', items: sorted.value }] : []
	}
	return bases
		.map((base) => ({
			base: base.base,
			heading: base.base,
			items: sorted.value.filter((item) => item.base === base.base)
		}))
		.filter((group) => group.items.length)
})

const validDate = (iso) => Boolean(iso) && !Number.isNaN(new Date(iso).getTime())

const formatDate = (iso) =>
	new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

const money = (amount, currency = 'USD') => formatMoney(amount, currency)

// --- Cloudflare Registrar ------------------------------------------------------------------

// The account picker only appears when the token can use more than one account.
const cfPickAccount = computed(() => accounts.value.length > 1)
const cfAccountItems = computed(() =>
	accounts.value.map((account) => ({ label: account.name || account.id, value: account.id }))
)
const cfAccountName = computed(() => findAccount(cfAccountId.value)?.name || '')
const cfAccountMissing = computed(
	() => cfEnabled.value && cfPickAccount.value && !cfAccountId.value && Boolean(result.value)
)
// Suggestions wait until the account is known, so they're asked for the right one.
const cfReady = computed(() => Boolean(cfAccountId.value) || (!cfPickAccount.value && !cfChecking.value))
const cfShown = computed(() => cfEnabled.value && Object.keys(cfChecks.value).length > 0)

const cfCheck = (item) => (cfEnabled.value ? cfChecks.value[item.domain] || null : null)

// Cloudflare's pricing for a name cf would register: registrable, standard-priced and quoted.
const cfQuote = (item) => {
	const check = cfCheck(item)
	const pricing = check?.pricing
	if (check?.registrable !== true || check.tier !== 'standard') return null
	return CF_CURRENCY.test(pricing?.currency || '') && pricing.registration_cost ? pricing : null
}

const showReferencePrice = (item) => Boolean(item.price) && item.availability !== 'registered'

const cfRenewalNote = (pricing) =>
	Number(pricing.renewal_cost) === Number(pricing.registration_cost)
		? 'Cloudflare quote'
		: `Cloudflare quote · renews at ${money(pricing.renewal_cost, pricing.currency)}`

const referenceNote = (price) =>
	price.renewal !== null && price.renewal !== price.registration
		? `${price.source} reference · renews at ${money(price.renewal, price.currency)}`
		: `${price.source} reference`

const registerLink = (item) => ({
	path: '/registrar',
	query: { ...(cfAccountId.value ? { account: cfAccountId.value } : {}), register: item.domain }
})

// As the console does: the account of the zone the sidebar last showed, or the token's only one.
const defaultAccount = () => {
	const fromZone = findZone(readStorage(STORAGE_KEYS.zoneId))?.account?.id
	if (fromZone && accounts.value.some((account) => account.id === fromZone)) return fromZone
	return accounts.value.length === 1 ? accounts.value[0].id : ''
}

// Checks every name in the result with Cloudflare Registrar, 20 to a request. A failure, such
// as a token without Registrar access, shows Cloudflare's message once and leaves the rest of
// the results alone.
const runCloudflareCheck = async () => {
	const id = ++cfRequestId
	cfChecks.value = {}
	cfError.value = ''
	cfChecking.value = false
	const names = (result.value?.results || []).map((item) => item.domain)
	if (!cfEnabled.value || !names.length) return

	cfChecking.value = true
	await Promise.all([loadAccounts(), loadZones()])
	if (id !== cfRequestId) return
	if (!cfAccountId.value) {
		const fallback = defaultAccount()
		// Setting the account starts a fresh check through the watcher below.
		if (fallback) {
			cfAccountId.value = fallback
			return
		}
	}
	if (cfPickAccount.value && !cfAccountId.value) {
		cfChecking.value = false
		return
	}

	const batches = []
	for (let index = 0; index < names.length; index += CF_BATCH) batches.push(names.slice(index, index + CF_BATCH))
	const outcomes = await Promise.allSettled(
		batches.map((domains) =>
			exec(
				'registrar registrations check',
				{ account: cfAccountId.value || undefined, body: { domains } },
				{ fallback: 'Cloudflare Registrar didn’t answer' }
			)
		)
	)
	if (id !== cfRequestId) return

	const found = {}
	let failure = null
	for (const outcome of outcomes) {
		if (outcome.status === 'rejected') {
			failure ??= outcome.reason
			continue
		}
		for (const entry of outcome.value?.result?.domains || []) {
			if (typeof entry?.name === 'string') found[entry.name.toLowerCase()] = entry
		}
	}
	cfChecks.value = found
	cfError.value = failure ? describeError(failure, 'Cloudflare Registrar didn’t answer') : ''
	cfChecking.value = false
	if (failure) {
		announcement.value = `Cloudflare Registrar didn’t check these names: ${cfError.value}`
	} else {
		const count = (result.value?.results || []).filter((item) => cfQuote(item)).length
		announcement.value = `Cloudflare Registrar can register ${count} of these names.`
	}
}

watch([cfEnabled, cfAccountId], () => {
	if (result.value) runCloudflareCheck()
	else cfRequestId++
})

// If the chosen view stops applying (Cloudflare's check turned off), fall back to everything.
watch(showItems, (items) => {
	if (!items.some((item) => item.value === show.value)) show.value = 'all'
})

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

// --- Endings, remembered between visits --------------------------------------------------

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

// --- Searching -----------------------------------------------------------------------------

const runSearch = async (params) => {
	const id = ++requestId
	loading.value = true
	error.value = ''
	inputError.value = ''
	announcement.value = ''
	lastParams.value = params
	try {
		const data = await call('domain_search', params, { fallback: 'The domain search failed' })
		if (id !== requestId) return
		result.value = data.result
		announcement.value = `Search finished for ${resultTitle.value}: ${countsLabel.value}.`
		runCloudflareCheck()
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

const searchParams = () => {
	searchedPhrase.value = entries.value[0]?.phrase || ''
	return { names: namesToCheck.value, tlds: [...selectedTlds.value] }
}

const submitSearch = () => {
	const trimmed = query.value.trim()
	inputError.value = ''
	if (!entries.value.length) {
		inputError.value = 'Enter a name to search for.'
		focusNameInput()
		return
	}
	if (!entries.value.some((entry) => entry.name.includes('.')) && !selectedTlds.value.length) {
		inputError.value = 'Choose at least one ending below, or include one in the name.'
		focusNameInput()
		return
	}
	if (overLimit.value) {
		inputError.value = plannedLabel.value
		focusNameInput()
		return
	}
	routeTerm = trimmed
	router.replace({ query: { ...route.query, q: trimmed } })
	runSearch(searchParams())
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
		runSearch(searchParams())
	},
	{ immediate: true }
)

onMounted(() => {
	loadZones()
})
</script>
