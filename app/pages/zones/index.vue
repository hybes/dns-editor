<template>
	<UDashboardPanel id="zones">
		<template #header>
			<UDashboardNavbar title="Zones">
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
				<template #right>
					<UButton
						icon="i-lucide-refresh-cw"
						label="Reload"
						color="neutral"
						variant="outline"
						:loading="loading"
						@click="reload"
					/>
				</template>
			</UDashboardNavbar>

			<UDashboardToolbar>
				<div class="flex w-full flex-wrap items-center gap-x-3 gap-y-2 py-2">
					<UFormField
						label="Search zones"
						class="min-w-40 flex-1 sm:max-w-80"
						:ui="{ labelWrapper: 'sr-only', container: 'mt-0' }"
					>
						<UInput
							ref="searchInput"
							v-model="search"
							name="zone-search"
							icon="i-lucide-search"
							placeholder="Search zones"
							autocomplete="off"
							:spellcheck="false"
							enterkeyhint="go"
							class="w-full"
							:ui="{ trailing: 'pe-1' }"
							@keydown.enter="openOnlyMatch"
						>
							<template #trailing>
								<UButton
									v-if="search"
									icon="i-lucide-x"
									color="neutral"
									variant="link"
									size="sm"
									aria-label="Clear search"
									@click="clearSearch"
								/>
								<UKbd v-else value="/" class="hidden sm:inline-flex" />
							</template>
						</UInput>
					</UFormField>
					<UFormField
						v-if="showRenewals"
						label="Sort zones"
						:ui="{ labelWrapper: 'sr-only', container: 'mt-0' }"
					>
						<USelect v-model="sortBy" :items="SORT_ITEMS" class="w-36 sm:w-40" />
					</UFormField>
					<p
						v-if="loaded"
						class="text-muted basis-full text-sm tabular-nums sm:basis-auto"
						aria-live="polite"
					>
						{{ countLabel }}
					</p>
				</div>
			</UDashboardToolbar>
		</template>

		<template #body>
			<UAlert
				v-if="error"
				color="error"
				variant="subtle"
				icon="i-lucide-circle-alert"
				:title="zones.length ? 'Couldn’t refresh zones' : 'Couldn’t load zones'"
				:actions="[
					{
						label: 'Try again',
						icon: 'i-lucide-refresh-cw',
						color: 'neutral',
						variant: 'outline',
						loading,
						onClick: reload
					}
				]"
			>
				<template #description>
					{{ error }}
					<template v-if="zones.length"> The list below is from the last successful load.</template>
				</template>
			</UAlert>

			<UTable
				v-if="!error || zones.length"
				:data="filteredZones"
				:columns="columns"
				:loading="loading || !loaded"
				:meta="TABLE_META"
				caption="Zones"
				:ui="{ td: 'py-3' }"
			>
				<template #name-cell="{ row }">
					<div class="min-w-0">
						<!-- The link stretches over the whole row, so the row opens the zone and keeps real link behaviour. -->
						<NuxtLink
							:to="recordsPath(row.original)"
							class="text-highlighted focus-visible:outline-primary rounded-sm font-medium wrap-anywhere after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
						>
							{{ row.original.name }}
						</NuxtLink>
						<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
							<UBadge
								v-for="badge in statusBadges(row.original)"
								:key="badge.label"
								v-bind="badge"
								size="sm"
							/>
							<span class="text-muted text-sm">{{ planLabel(row.original) }}</span>
							<span v-if="hasSeveralAccounts" class="text-muted text-sm wrap-anywhere">
								{{ accountLabel(row.original) }}
							</span>
						</div>
						<p
							v-if="registrationFor(row.original.name)"
							class="text-muted mt-1 text-sm md:hidden"
							:class="{ 'text-warning': expiresSoon(registrationFor(row.original.name)) }"
						>
							{{ renewalLabel(registrationFor(row.original.name)) }}
						</p>
					</div>
				</template>

				<template #status-cell="{ row }">
					<div class="flex items-center gap-1.5">
						<UBadge v-for="badge in statusBadges(row.original)" :key="badge.label" v-bind="badge" />
					</div>
				</template>

				<template #plan-cell="{ row }">
					{{ planLabel(row.original) }}
				</template>

				<template #account-cell="{ row }">
					<span class="block max-w-64 truncate" :title="accountLabel(row.original)">
						{{ accountLabel(row.original) }}
					</span>
					<span
						v-if="hasSeveralConnections && row.original.connection?.label !== row.original.account?.name"
						class="text-muted block max-w-64 truncate text-xs"
					>
						via {{ row.original.connection?.label }}
					</span>
				</template>

				<template #renews-cell="{ row }">
					<template v-if="registrationFor(row.original.name)">
						<time
							v-if="formatDate(registrationFor(row.original.name).expires_at)"
							:datetime="registrationFor(row.original.name).expires_at"
							:class="{ 'text-warning': expiresSoon(registrationFor(row.original.name)) }"
						>
							{{ formatDate(registrationFor(row.original.name).expires_at) }}
						</time>
						<span v-else class="text-dimmed">Not yet known</span>
					</template>
					<span v-else class="text-dimmed" :title="NOT_REGISTERED">—</span>
				</template>

				<template #autoRenew-cell="{ row }">
					<!-- Above the row's stretched link, so the switch gets the click. -->
					<div
						v-if="
							registrationFor(row.original.name) && registrationFor(row.original.name).editable !== false
						"
						class="relative z-10 flex"
					>
						<USwitch
							:model-value="registrationFor(row.original.name).auto_renew === true"
							:loading="autoRenew.pending.has(registrationFor(row.original.name).domain_name)"
							:disabled="autoRenew.pending.has(registrationFor(row.original.name).domain_name)"
							:aria-label="`Auto-renew ${row.original.name}`"
							@update:model-value="
								(value) =>
									autoRenew.ask(
										registrationFor(row.original.name),
										value,
										registrationFor(row.original.name).account
									)
							"
						/>
					</div>
					<!-- A shared domain with view-only renewal access shows the setting without changing it. -->
					<span v-else-if="registrationFor(row.original.name)" class="text-muted">
						{{ registrationFor(row.original.name).auto_renew ? 'On' : 'Off' }}
					</span>
				</template>

				<template #renewal-cell="{ row }">
					<span
						v-if="priceFor(row.original.name)"
						class="tabular-nums"
						:title="priceFor(row.original.name).standard ? standardTitle(row.original.name) : undefined"
					>
						{{ formatMoney(priceFor(row.original.name).amount, priceFor(row.original.name).currency) }}
						<span class="text-muted">a year</span>
					</span>
				</template>

				<template #open-cell>
					<UIcon name="i-lucide-chevron-right" class="text-dimmed block size-4" />
				</template>

				<template #loading>
					<div v-if="!loaded" class="flex flex-col gap-4 text-start">
						<span role="status" class="sr-only">Loading zones</span>
						<div v-for="n in 6" :key="n" class="flex items-center gap-6">
							<USkeleton class="h-4 w-full max-w-56" />
							<USkeleton class="hidden h-5 w-16 sm:block" />
							<USkeleton class="hidden h-4 w-28 sm:block" />
						</div>
					</div>
					<UEmpty v-else variant="naked" v-bind="emptyState" />
				</template>

				<template #empty>
					<UEmpty variant="naked" v-bind="emptyState" />
				</template>
			</UTable>

			<div
				v-if="(showRenewals || registrations.denied.value) && filteredZones.length"
				class="text-muted mt-3 flex flex-col gap-1 text-xs text-pretty"
			>
				<p v-if="registrations.denied.value">
					Renewal dates come from Cloudflare Registrar, which your connections can’t read.
					<ULink to="/connections" class="text-highlighted underline"
						>Add a connection DNS Manager makes itself</ULink
					>, with every permission it uses.
				</p>
				<p v-else-if="registrations.loading.value && !anyPrice">Loading renewal prices from Cloudflare…</p>
				<p v-if="anyStandardPrice">
					Renewal prices are Cloudflare’s current ones. Where Cloudflare doesn’t quote a domain itself, it’s
					the price of a standard name on the same ending; premium names can cost more.
				</p>
			</div>

			<RegistrarConfirmModal
				v-model:open="autoRenew.open.value"
				:title="autoRenew.copy.value.title"
				:description="autoRenew.copy.value.description"
				:confirm-label="autoRenew.copy.value.confirm"
				:confirm-icon="autoRenew.target.value?.enable ? 'i-lucide-repeat' : 'i-lucide-circle-off'"
				:confirm-color="autoRenew.target.value?.enable ? 'primary' : 'warning'"
				error-title="Cloudflare didn’t change auto-renew"
				:action="autoRenew.apply"
			>
				<p v-if="autoRenew.copy.value.detail" class="text-muted">{{ autoRenew.copy.value.detail }}</p>
			</RegistrarConfirmModal>
		</template>
	</UDashboardPanel>
</template>

<script setup>
import { useDebounceFn } from '@vueuse/core'
import { API_TOKENS_URL } from '#shared/utils/cloudflare'

useSeoMeta({ title: 'Zones' })

// Tailwind only generates classes it finds written out in full, so these stay literal.
const FROM_SM = { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' } }
const FROM_MD = { class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell' } }
const FROM_LG = { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' } }

const SORT_ITEMS = [
	{ label: 'Name', value: 'name' },
	{ label: 'Renewal date', value: 'renews' }
]
const NOT_REGISTERED = 'Not registered with Cloudflare Registrar'
const TABLE_META = { class: { tr: 'relative hover:bg-elevated/50 has-[a:focus-visible]:bg-elevated/50' } }

const route = useRoute()
const router = useRouter()
const { zones, loading, error, loaded, load } = useZones()

onMounted(() => {
	load()
})

// --- Renewals ------------------------------------------------------------------------------------
// Expiry, auto-renew and renewal price for zones registered with Cloudflare Registrar, from the
// accounts that own the zones.

const registrations = useRegistrations()
const { registrationFor, priceFor } = registrations
// Once zones are listed, so the renewals match the zones on the page.
watch(
	() => zones.value.length,
	(count) => {
		if (count) registrations.load()
	},
	{ immediate: true }
)

const registeredCount = computed(() => zones.value.filter((zone) => registrationFor(zone.name)).length)
const showRenewals = computed(() => registeredCount.value > 0)
const anyPrice = computed(() => filteredZones.value.some((zone) => priceFor(zone.name)))
const anyStandardPrice = computed(() => filteredZones.value.some((zone) => priceFor(zone.name)?.standard))

const renewalLabel = (registration) => {
	const date = formatDate(registration.expires_at)
	if (!date) return 'Renewal date not yet known'
	return registration.auto_renew ? `Renews ${date}` : `Expires ${date}, auto-renew off`
}

const standardTitle = (domain) =>
	`Cloudflare’s current renewal price for a standard .${domain.split('.').slice(1).join('.')} name`

const autoRenew = useAutoRenew({
	priceNote: (domain) => {
		const price = priceFor(domain)
		if (!price) return ''
		const amount = formatMoney(price.amount, price.currency)
		return price.standard
			? `Cloudflare renews a standard name on this ending for ${amount} a year today. Renewal prices follow the registry and can change.`
			: `Cloudflare quotes ${amount} a year to renew it. Renewal prices follow the registry and can change.`
	},
	onChanged: (updated) => registrations.update(updated),
	pendingHint: 'The Registrar page shows the progress.'
})

const reload = () => {
	load({ force: true })
	registrations.load({ force: true })
}

const recordsPath = (zone) => `/zones/${zone.id}/records`

const statusBadges = (zone) => {
	const badges = [{ ...zoneStatusBadge(zone.status), variant: 'subtle' }]
	if (zone.paused) badges.push({ label: 'Paused', color: 'neutral', variant: 'outline' })
	return badges
}

const planLabel = (zone) => [zone.plan?.name, SETUP_LABELS[zone.type]?.short].filter(Boolean).join(' · ') || '—'

const auth = useAuth()
const hasSeveralConnections = computed(() => auth.connections.value.length > 1)
const hasSeveralAccounts = computed(
	() =>
		hasSeveralConnections.value ||
		zones.value.some((zone) => zone.shared) ||
		new Set(zones.value.map((zone) => zone.account?.id).filter(Boolean)).size > 1
)
// A shared zone's account is its owner's, so it says who shares it instead.
const accountLabel = (zone) => (zone.shared ? `Shared by ${zone.shared.owner}` : zone.account?.name || '—')

const columns = computed(() => [
	{ id: 'name', accessorKey: 'name', header: 'Domain', meta: { class: { td: 'whitespace-normal' } } },
	{ id: 'status', accessorKey: 'status', header: 'Status', meta: FROM_SM },
	{ id: 'plan', header: 'Plan', meta: FROM_SM },
	...(hasSeveralAccounts.value ? [{ id: 'account', header: 'Account', meta: FROM_MD }] : []),
	...(showRenewals.value
		? [
				{ id: 'renews', header: 'Renews', meta: FROM_MD },
				{ id: 'autoRenew', header: 'Auto-renew', meta: FROM_SM },
				{ id: 'renewal', header: 'Renewal price', meta: FROM_LG }
			]
		: []),
	{ id: 'open', header: '', meta: { class: { th: 'w-px', td: 'w-px ps-0' } } }
])

// Search

const searchInput = useTemplateRef('searchInput')
const pagePath = route.path
const queryValue = () => (typeof route.query.search === 'string' ? route.query.search : '')
const search = ref(queryValue())
let syncedSearch = search.value.trim()

// replace() keeps typing out of the history. A late update is dropped once the page is
// navigating away, so it can't rewrite the next page's query.
const writeQuery = useDebounceFn((value) => {
	if (router.currentRoute.value.path !== pagePath) return
	syncedSearch = value
	const { search: _previous, ...rest } = route.query
	router.replace({ query: value ? { ...rest, search: value } : rest })
}, 250)

watch(search, (value) => writeQuery(value.trim()))

// Follow a ?search set from elsewhere without undoing typing that hasn't synced yet.
watch(
	() => route.query.search,
	() => {
		if (route.path !== pagePath) return
		const value = queryValue()
		if (value === syncedSearch) return
		syncedSearch = value
		search.value = value
	}
)

const focusSearch = () => {
	const input = searchInput.value?.inputRef
	input?.focus()
	// Selecting only for the shortcut means clicking into the field never wipes the query.
	input?.select()
}

const clearSearch = () => {
	search.value = ''
	searchInput.value?.inputRef?.focus()
}

defineShortcuts({
	'/': focusSearch,
	escape: {
		usingInput: 'zone-search',
		handler: () => {
			if (search.value) search.value = ''
			else searchInput.value?.inputRef?.blur()
		}
	}
})

const term = computed(() => search.value.trim().toLowerCase())

const sortBy = ref('name')

// Soonest renewal first; zones not registered with Cloudflare Registrar after, by name.
const byRenewal = (a, b) => {
	const time = (zone) => Date.parse(registrationFor(zone.name)?.expires_at || '') || Infinity
	return time(a) - time(b) || a.name.localeCompare(b.name)
}

const filteredZones = computed(() => {
	const matching = term.value
		? zones.value.filter((zone) =>
				[
					zone.name,
					zone.status,
					zone.plan?.name,
					zone.account?.name,
					zone.connection?.label,
					zone.shared?.owner
				].some((field) => field?.toLowerCase().includes(term.value))
			)
		: zones.value
	return sortBy.value === 'renews' && showRenewals.value ? [...matching].sort(byRenewal) : matching
})

const openOnlyMatch = () => {
	if (term.value && filteredZones.value.length === 1) navigateTo(recordsPath(filteredZones.value[0]))
}

const zoneCount = (count) => `${count} ${count === 1 ? 'zone' : 'zones'}`

const countLabel = computed(() => {
	const count = term.value
		? `${filteredZones.value.length} of ${zoneCount(zones.value.length)}`
		: zoneCount(zones.value.length)
	return showRenewals.value ? `${count} · ${registeredCount.value} on Cloudflare Registrar` : count
})

const emptyState = computed(() => {
	if (term.value && zones.value.length) {
		return {
			icon: 'i-lucide-search-x',
			title: `No zones match “${search.value.trim()}”`,
			description: 'Search looks at the domain, status, plan and account.',
			actions: [
				{
					label: 'Clear search',
					icon: 'i-lucide-x',
					color: 'neutral',
					variant: 'outline',
					onClick: clearSearch
				}
			]
		}
	}
	return {
		icon: 'i-lucide-globe',
		title: 'Your connections can’t see any zones',
		description:
			'Give a connection’s token Zone: Read access to the zones you manage, add another connection, or add a site to your Cloudflare account.',
		actions: [
			{
				label: 'Open connections',
				icon: 'i-lucide-key-round',
				color: 'neutral',
				variant: 'outline',
				to: '/connections'
			},
			{
				label: 'Manage API tokens',
				icon: 'i-lucide-external-link',
				color: 'neutral',
				variant: 'ghost',
				to: API_TOKENS_URL,
				target: '_blank'
			}
		]
	}
})
</script>
