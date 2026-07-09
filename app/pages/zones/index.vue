<template>
	<Loader
		v-if="loading && !appBootLoading"
		fullscreen
		title="Loading Your Zones"
		subtitle="Fetching your zone list from Cloudflare…"
	/>

	<PageContainer v-else>
		<Head>
			<Title>Zones</Title>
		</Head>

		<section aria-labelledby="zones-title" class="mx-auto w-full max-w-7xl">
			<header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<div class="flex items-center gap-3">
						<div
							class="bg-primary/10 ring-primary/20 flex h-11 w-11 items-center justify-center rounded-xl ring-1"
						>
							<UIcon name="i-heroicons-globe-alt" class="text-primary h-6 w-6" aria-hidden="true" />
						</div>
						<div>
							<p class="text-primary text-xs font-semibold tracking-wide uppercase">Workspace</p>
							<h1
								id="zones-title"
								class="text-highlighted text-2xl font-semibold tracking-tight sm:text-3xl"
							>
								Your Zones
							</h1>
						</div>
					</div>
					<p class="text-muted mt-3 max-w-2xl text-sm">
						Choose a Cloudflare zone to inspect and manage its DNS records.
					</p>
				</div>
				<CapabilityIndicator :missing-items="capabilityMissing" />
			</header>

			<div class="surface-panel overflow-hidden">
				<div class="border-default space-y-4 border-b px-4 py-5 sm:px-6">
					<div v-if="recentZones.length">
						<p class="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">Recent Zones</p>
						<nav class="flex flex-wrap gap-2" aria-label="Recent zones">
							<UButton
								v-for="zone in recentZones"
								:key="zone.id"
								:to="`/zones/${zone.id}/records`"
								size="sm"
								variant="soft"
								color="neutral"
								icon="i-heroicons-clock"
								@click="prepareZone(zone)"
							>
								{{ zone.name }}
							</UButton>
						</nav>
					</div>

					<div>
						<label for="zone-search" class="text-highlighted mb-1.5 block text-sm font-medium"
							>Search Zones</label
						>
						<div class="relative">
							<UTooltip text="Press / to search">
								<UInput
									id="zone-search"
									ref="searchInput"
									v-model="searchQuery"
									name="zone-search"
									autocomplete="off"
									:spellcheck="false"
									icon="i-heroicons-magnifying-glass-20-solid"
									type="search"
									placeholder="Search by domain or status…"
									color="neutral"
									class="w-full transition-shadow focus-within:shadow-md"
									size="lg"
									:ui="{ base: 'pe-11' }"
									@focus="focusSearchInput"
								/>
							</UTooltip>
							<UButton
								v-if="searchQuery"
								variant="ghost"
								color="neutral"
								size="xs"
								icon="i-heroicons-x-mark-20-solid"
								aria-label="Clear zone search"
								class="absolute top-1.5 right-1.5"
								@click="searchQuery = ''"
							/>
						</div>
					</div>
				</div>

				<div class="px-4 py-5 sm:px-6">
					<UAlert
						v-if="loadError"
						color="error"
						variant="subtle"
						icon="i-heroicons-exclamation-triangle"
						title="Couldn’t Load Zones"
						:description="loadError"
						class="mb-5"
					>
						<template #actions>
							<UButton
								color="error"
								variant="soft"
								size="sm"
								:loading="loading"
								@click="getZones({ preferCache: false })"
							>
								Try Again
							</UButton>
						</template>
					</UAlert>

					<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
						<p class="text-muted text-sm tabular-nums">
							{{ filteredZones.length }} of {{ zones.length }} zones
						</p>
						<div class="bg-muted flex items-center gap-1 rounded-lg p-1" aria-label="Zone view">
							<UButton
								size="sm"
								:variant="viewMode === 'grid' ? 'soft' : 'ghost'"
								:color="viewMode === 'grid' ? 'primary' : 'neutral'"
								icon="i-heroicons-squares-2x2"
								:aria-pressed="viewMode === 'grid'"
								@click="viewMode = 'grid'"
							>
								Grid
							</UButton>
							<UButton
								size="sm"
								:variant="viewMode === 'table' ? 'soft' : 'ghost'"
								:color="viewMode === 'table' ? 'primary' : 'neutral'"
								icon="i-heroicons-table-cells"
								:aria-pressed="viewMode === 'table'"
								@click="viewMode = 'table'"
							>
								Table
							</UButton>
						</div>
					</div>

					<div
						v-if="!filteredZones.length && !loadError"
						class="flex flex-col items-center py-12 text-center"
					>
						<div class="bg-muted mb-3 flex h-12 w-12 items-center justify-center rounded-full">
							<UIcon name="i-heroicons-globe-alt" class="text-muted h-6 w-6" aria-hidden="true" />
						</div>
						<h2 class="text-highlighted font-semibold">
							{{ searchQuery ? 'No Matching Zones' : 'No Zones Found' }}
						</h2>
						<p class="text-muted mt-1 max-w-md text-sm">
							{{
								searchQuery
									? 'Try a different domain or clear the search.'
									: 'This API token cannot access any zones.'
							}}
						</p>
						<UButton
							v-if="searchQuery"
							class="mt-4"
							variant="soft"
							color="neutral"
							@click="searchQuery = ''"
						>
							Clear Search
						</UButton>
					</div>

					<div v-else-if="viewMode === 'grid'" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<article
							v-for="zone in filteredZones"
							:key="zone.id"
							class="border-default bg-default hover:border-primary/40 flex min-w-0 flex-col gap-4 rounded-xl border p-4 transition-colors"
						>
							<div class="flex min-w-0 items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="flex min-w-0 items-center gap-2">
										<UIcon
											name="i-heroicons-globe-alt"
											class="text-primary h-5 w-5 shrink-0"
											aria-hidden="true"
										/>
										<h2 class="text-highlighted truncate font-semibold">{{ zone.name }}</h2>
									</div>
									<p class="text-dimmed mt-1 truncate font-mono text-xs" :title="zone.id">
										{{ zone.id }}
									</p>
								</div>
								<UBadge
									:color="zone.status === 'active' ? 'success' : 'warning'"
									variant="subtle"
									class="shrink-0 capitalize"
								>
									{{ zone.status }}
								</UBadge>
							</div>
							<UButton
								:to="`/zones/${zone.id}/records`"
								color="primary"
								variant="soft"
								icon="i-heroicons-arrow-right-20-solid"
								trailing
								block
								@click="prepareZone(zone)"
							>
								Manage Records
							</UButton>
						</article>
					</div>

					<div v-else class="border-default w-full overflow-x-auto rounded-lg border">
						<UTable
							:data="filteredZones"
							:columns="columns"
							:loading="loading"
							:ui="{ tr: { base: 'hover:bg-muted/70' } }"
						>
							<template #name-cell="{ row }">
								<div class="flex min-w-48 items-center gap-3">
									<UIcon
										name="i-heroicons-globe-alt"
										class="text-primary h-5 w-5 shrink-0"
										aria-hidden="true"
									/>
									<div class="min-w-0">
										<div class="text-highlighted truncate font-medium">{{ row.original.name }}</div>
										<div class="text-dimmed truncate font-mono text-xs">{{ row.original.id }}</div>
									</div>
								</div>
							</template>
							<template #status-cell="{ row }">
								<UBadge
									:color="row.original.status === 'active' ? 'success' : 'warning'"
									variant="subtle"
									class="capitalize"
								>
									{{ row.original.status }}
								</UBadge>
							</template>
							<template #actions-cell="{ row }">
								<UButton
									:to="`/zones/${row.original.id}/records`"
									color="primary"
									variant="soft"
									size="sm"
									icon="i-heroicons-arrow-right-20-solid"
									@click="prepareZone(row.original)"
								>
									Manage Records
								</UButton>
							</template>
						</UTable>
					</div>
				</div>
			</div>
		</section>
	</PageContainer>
</template>

<script setup>
import { useDebounceFn } from '@vueuse/core'

const appBootLoading = useState('appBootLoading')
const { getApiKey } = useSession()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const apiKey = ref('')
const zones = ref([])
const loading = ref(true)
const loadError = ref('')
const searchInput = ref(null)
const searchQuery = ref(typeof route.query.search === 'string' ? route.query.search : '')
const capabilityMissing = ref([])
const viewMode = ref(route.query.view === 'table' ? 'table' : 'grid')
const recentZones = ref([])
const zonesCacheTtl = 30000
const zonesCache = useState('zones-cache', () => ({}))
const zonesRequestBody = computed(() => ({ apiKey: apiKey.value }))
const {
	data: zonesData,
	error: zonesError,
	refresh: refreshZones
} = useFetch('/api/zones', {
	method: 'POST',
	body: zonesRequestBody,
	server: false,
	immediate: false
})

const columns = [
	{ id: 'name', accessorKey: 'name', header: 'Domain' },
	{ id: 'status', accessorKey: 'status', header: 'Status' },
	{ id: 'actions', header: 'Actions', enableSorting: false }
]

const getZonesCacheKey = () => apiKey.value
const readZonesCache = () => zonesCache.value[getZonesCacheKey()]
const writeZonesCache = (items) => {
	if (!apiKey.value) return
	zonesCache.value[getZonesCacheKey()] = {
		zones: items,
		fetchedAt: Date.now()
	}
}

// Function to focus and select text in search input
const focusSearchInput = () => {
	setTimeout(() => {
		const input = document.getElementById('zone-search')
		if (input) {
			input.select()
		}
	}, 100)
}

// Filtered zones based on search query
const filteredZones = computed(() => {
	if (!searchQuery.value) return zones.value

	const query = searchQuery.value.trim().toLowerCase()
	return zones.value.filter(
		(zone) => zone?.name?.toLowerCase().includes(query) || zone?.status?.toLowerCase().includes(query)
	)
})

const addRecentZone = (entry) => {
	const rest = recentZones.value.filter((z) => z.id !== entry.id)
	recentZones.value = [entry, ...rest].slice(0, 6)
	localStorage.setItem(STORAGE_KEYS.recentZones, JSON.stringify(recentZones.value))
}

onMounted(async () => {
	apiKey.value = getApiKey()
	if (!apiKey.value) return

	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.recentZones) || '[]')
		recentZones.value = (Array.isArray(parsed) ? parsed : []).filter((z) => z && z.id && z.name)
	} catch {
		recentZones.value = []
	}

	const capsPromise = (async () => {
		try {
			const { loadGlobal, missing } = useCapabilities()
			const caps = await loadGlobal(apiKey.value)
			capabilityMissing.value = missing(caps)
		} catch {
			capabilityMissing.value = []
		}
	})()

	window.addEventListener('keydown', handleKeyDown)

	const savedView = localStorage.getItem('zones-view-mode')
	if (!route.query.view && (savedView === 'grid' || savedView === 'table')) viewMode.value = savedView

	const cacheEntry = readZonesCache()
	if (cacheEntry?.zones?.length) {
		zones.value = cacheEntry.zones
		loading.value = false
	}

	await Promise.all([capsPromise, getZones()])
})

onUnmounted(() => {
	window.removeEventListener('keydown', handleKeyDown)
})

// Keyboard shortcut handler
const handleKeyDown = (e) => {
	if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
		e.preventDefault()
		document.getElementById('zone-search')?.focus()
	}
}

const syncRouteQuery = useDebounceFn(() => {
	const query = { ...route.query }
	if (searchQuery.value.trim()) query.search = searchQuery.value.trim()
	else delete query.search
	if (viewMode.value === 'table') query.view = 'table'
	else delete query.view
	router.replace({ query })
}, 200)

watch(searchQuery, syncRouteQuery)

watch(viewMode, (v) => {
	localStorage.setItem('zones-view-mode', v)
	syncRouteQuery()
})

const getZones = async ({ preferCache = true } = {}) => {
	loading.value = true
	loadError.value = ''
	if (preferCache) {
		const cacheEntry = readZonesCache()
		if (cacheEntry?.zones?.length) {
			zones.value = cacheEntry.zones
			if (Date.now() - cacheEntry.fetchedAt < zonesCacheTtl) {
				loading.value = false
				return
			}
		}
	}

	try {
		await refreshZones()
		if (zonesError.value) throw zonesError.value
		if (zonesData.value?.success === false) {
			throw new Error(zonesData.value.errors?.[0]?.message || 'Cloudflare rejected the zones request')
		}
		zones.value = zonesData.value?.result || []
		writeZonesCache(zones.value)
	} catch (error) {
		console.error('Error fetching zones:', error)
		const message = error?.data?.statusMessage || error?.statusMessage || error?.message || 'Failed to fetch zones'
		loadError.value = `${message}. Check the token permissions and try again.`
		toast.add({
			id: 'get-zones-error' + Date.now(),
			title: 'Couldn’t Load Zones',
			description: message,
			icon: 'i-clarity-warning-solid',
			duration: 3000,
			color: 'error'
		})
	} finally {
		loading.value = false
	}
}

const prepareZone = (zone) => {
	localStorage.setItem(STORAGE_KEYS.zoneId, zone.id)
	localStorage.setItem(STORAGE_KEYS.zoneName, zone.name)
	addRecentZone({ id: zone.id, name: zone.name })
}
</script>
