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
				<div class="flex w-full items-center gap-3">
					<UFormField
						label="Search zones"
						class="min-w-0 flex-1 sm:max-w-80"
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
					<p v-if="loaded" class="text-muted shrink-0 text-sm tabular-nums" aria-live="polite">
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
								{{ row.original.account?.name }}
							</span>
						</div>
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
					<span class="block max-w-64 truncate" :title="row.original.account?.name">
						{{ row.original.account?.name || '—' }}
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
const TABLE_META = { class: { tr: 'relative hover:bg-elevated/50 has-[a:focus-visible]:bg-elevated/50' } }

const route = useRoute()
const router = useRouter()
const { zones, loading, error, loaded, load } = useZones()

onMounted(() => {
	load()
})

const reload = () => load({ force: true })

const recordsPath = (zone) => `/zones/${zone.id}/records`

const statusBadges = (zone) => {
	const badges = [{ ...zoneStatusBadge(zone.status), variant: 'subtle' }]
	if (zone.paused) badges.push({ label: 'Paused', color: 'neutral', variant: 'outline' })
	return badges
}

const planLabel = (zone) => [zone.plan?.name, SETUP_LABELS[zone.type]?.short].filter(Boolean).join(' · ') || '—'

const hasSeveralAccounts = computed(() => new Set(zones.value.map((zone) => zone.account?.id).filter(Boolean)).size > 1)

const columns = computed(() => [
	{ id: 'name', accessorKey: 'name', header: 'Domain', meta: { class: { td: 'whitespace-normal' } } },
	{ id: 'status', accessorKey: 'status', header: 'Status', meta: FROM_SM },
	{ id: 'plan', header: 'Plan', meta: FROM_SM },
	...(hasSeveralAccounts.value ? [{ id: 'account', header: 'Account', meta: FROM_MD }] : []),
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

const filteredZones = computed(() => {
	if (!term.value) return zones.value
	return zones.value.filter((zone) =>
		[zone.name, zone.status, zone.plan?.name, zone.account?.name].some((field) =>
			field?.toLowerCase().includes(term.value)
		)
	)
})

const openOnlyMatch = () => {
	if (term.value && filteredZones.value.length === 1) navigateTo(recordsPath(filteredZones.value[0]))
}

const zoneCount = (count) => `${count} ${count === 1 ? 'zone' : 'zones'}`

const countLabel = computed(() =>
	term.value ? `${filteredZones.value.length} of ${zoneCount(zones.value.length)}` : zoneCount(zones.value.length)
)

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
		title: 'This token can’t see any zones',
		description: 'Give it Zone: Read access to the zones you manage, or add a site to your Cloudflare account.',
		actions: [
			{
				label: 'Replace token',
				icon: 'i-lucide-key-round',
				color: 'neutral',
				variant: 'outline',
				to: '/login?replace=1'
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
