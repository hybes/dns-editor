<template>
	<PageContainer>
		<Head>
			<Title>Zones</Title>
		</Head>
		<div class="flex min-h-[70vh] w-full flex-col items-center justify-center">
			<Loader
				v-if="loading && !appBootLoading"
				fullscreen
				title="Loading your zones"
				subtitle="Fetching zone list from Cloudflare…"
			/>
			<div v-else-if="!loading" class="flex w-full flex-col items-center justify-center gap-6">
				<div class="flex flex-col items-center justify-center gap-3">
					<div class="flex items-center gap-2.5">
						<div
							class="bg-primary/10 ring-primary/20 flex h-9 w-9 items-center justify-center rounded-xl ring-1"
						>
							<UIcon name="i-heroicons-cloud" class="text-primary h-5 w-5" />
						</div>
						<h1 class="text-2xl font-semibold tracking-tight">DNS Manager</h1>
					</div>
					<CapabilityIndicator :missing-items="capabilityMissing" />
				</div>
				<div class="max-w-8xl dark:border-comet-700 flex w-full flex-col rounded-lg border p-4">
					<div class="mb-4 flex flex-col gap-2">
						<h2 class="text-lg font-medium">Your Zones</h2>
						<div class="text-comet-500 text-sm">Select a zone to manage its DNS records</div>
					</div>
					<div v-if="recentZones.length" class="mb-4 flex flex-wrap items-center gap-2">
						<span class="text-comet-500 text-xs font-medium">Recent:</span>
						<UButton
							v-for="z in recentZones"
							:key="z.id"
							size="xs"
							variant="soft"
							color="neutral"
							icon="i-heroicons-clock"
							@click="navigateToZone(z.id)"
						>
							{{ z.name }}
						</UButton>
					</div>
					<div class="relative mb-4 w-full">
						<UTooltip text="Press '/' to search">
							<UInput
								ref="searchInput"
								v-model="searchQuery"
								icon="i-heroicons-magnifying-glass-20-solid"
								type="text"
								placeholder="Search zones..."
								color="neutral"
								class="w-full transition-all focus-within:shadow-md"
								size="lg"
								@focus="focusSearchInput"
							/>
						</UTooltip>
						<UButton
							v-if="searchQuery"
							variant="ghost"
							color="neutral"
							size="xs"
							icon="i-heroicons-x-mark-20-solid"
							aria-label="Clear search"
							class="absolute top-1.5 right-1.5"
							@click="searchQuery = ''"
						/>
					</div>
					<div class="mb-4 flex w-full flex-wrap items-center justify-between gap-3">
						<div class="text-comet-500 text-sm">{{ filteredZones.length }} zones</div>
						<div class="flex items-center gap-2">
							<UButton
								size="sm"
								variant="outline"
								:color="viewMode === 'grid' ? 'primary' : 'neutral'"
								icon="i-heroicons-squares-2x2"
								@click="viewMode = 'grid'"
							>
								Grid
							</UButton>
							<UButton
								size="sm"
								variant="outline"
								:color="viewMode === 'table' ? 'primary' : 'neutral'"
								icon="i-heroicons-table-cells"
								@click="viewMode = 'table'"
							>
								Table
							</UButton>
						</div>
					</div>

					<div
						v-if="!filteredZones.length"
						class="flex flex-col items-center justify-center gap-3 py-10 text-center"
					>
						<UIcon name="i-heroicons-globe-alt" class="text-comet-400 h-8 w-8" />
						<p class="text-comet-600 dark:text-comet-300 text-sm">
							{{ searchQuery ? 'No zones match your search.' : 'No zones found for this API token.' }}
						</p>
					</div>

					<div
						v-else-if="viewMode === 'grid'"
						class="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
					>
						<div
							v-for="zone in filteredZones"
							:key="zone.id"
							role="button"
							tabindex="0"
							:aria-label="`Manage DNS for ${zone.name}`"
							class="border-comet-200 hover:bg-comet-50 dark:border-comet-700 dark:hover:bg-comet-800 focus-visible:ring-primary flex cursor-pointer flex-col gap-3 rounded-lg border p-4 focus-visible:ring-2 focus-visible:outline-none"
							@click="navigateToZone(zone.id)"
							@keydown.enter.prevent="navigateToZone(zone.id)"
							@keydown.space.prevent="navigateToZone(zone.id)"
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<UIcon name="i-heroicons-globe-alt" class="text-blue-500" />
										<div class="truncate font-medium">{{ zone.name }}</div>
									</div>
									<div class="text-comet-500 mt-1 text-xs">{{ zone.id }}</div>
								</div>
								<UBadge
									:color="zone.status === 'active' ? 'success' : 'warning'"
									variant="subtle"
									class="uppercase"
								>
									{{ zone.status }}
								</UBadge>
							</div>
							<div class="flex justify-end">
								<UButton
									color="primary"
									variant="soft"
									size="sm"
									icon="i-heroicons-pencil-square"
									@click.stop="navigateToZone(zone.id)"
								>
									Manage Records
								</UButton>
							</div>
						</div>
					</div>

					<div v-else class="w-full rounded-sm">
						<UTable
							:data="filteredZones"
							:columns="columns"
							:loading="loading"
							:ui="{
								tr: {
									base: 'cursor-pointer hover:bg-comet-100 dark:hover:bg-comet-800'
								}
							}"
							@select="onSelectZone"
						>
							<template #name-cell="{ row }">
								<div class="flex items-center gap-3">
									<UIcon name="i-heroicons-globe-alt" class="text-blue-500" />
									<div class="font-medium">{{ row.original.name }}</div>
								</div>
							</template>
							<template #status-cell="{ row }">
								<UBadge
									:color="row.original.status === 'active' ? 'success' : 'warning'"
									variant="subtle"
									class="uppercase"
								>
									{{ row.original.status }}
								</UBadge>
							</template>
							<template #actions-cell="{ row }">
								<div class="flex gap-2">
									<UButton
										color="primary"
										variant="soft"
										size="sm"
										icon="i-heroicons-pencil-square"
										@click.stop="navigateToZone(row.original.id)"
									>
										Manage Records
									</UButton>
								</div>
							</template>
						</UTable>
					</div>
				</div>
			</div>
		</div>
	</PageContainer>
</template>

<script setup>
const appBootLoading = useState('appBootLoading')
const { getApiKey } = useSession()
const apiKey = ref('')
const zones = ref([])
const loading = ref(true)
const router = useRouter()
const searchInput = ref(null)
const searchQuery = ref('')
const capabilityMissing = ref([])
const viewMode = ref('grid')
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
		const input = searchInput.value?.$el.querySelector('input')
		if (input) {
			input.select()
		}
	}, 100)
}

// Filtered zones based on search query
const filteredZones = computed(() => {
	if (!searchQuery.value) return zones.value

	const query = searchQuery.value.toLowerCase()
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
	if (savedView === 'grid' || savedView === 'table') viewMode.value = savedView

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
	if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
		e.preventDefault()
		searchInput.value?.$el.querySelector('input')?.focus()
	}
}

watch(viewMode, (v) => {
	localStorage.setItem('zones-view-mode', v)
})

const getZones = async ({ preferCache = true } = {}) => {
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
		zones.value = zonesData.value?.result || []
		writeZonesCache(zones.value)
	} catch (error) {
		console.error('Error fetching zones:', error)
		const toast = useToast()
		const message = error?.data?.statusMessage || error?.statusMessage || 'Failed to fetch zones'
		toast.add({
			id: 'get-zones-error' + Date.now(),
			title: 'Error',
			description: message,
			icon: 'i-clarity-warning-solid',
			duration: 3000,
			color: 'error'
		})
	} finally {
		loading.value = false
	}
}

const navigateToZone = (zoneId) => {
	localStorage.setItem(STORAGE_KEYS.zoneId, zoneId)

	const zone = zones.value.find((z) => z.id === zoneId)
	if (zone) {
		localStorage.setItem(STORAGE_KEYS.zoneName, zone.name)
		addRecentZone({ id: zone.id, name: zone.name })
	}

	router.push(`/zones/${zoneId}/records`)
}

const onSelectZone = (_e, row) => {
	navigateToZone(row.original.id)
}
</script>
