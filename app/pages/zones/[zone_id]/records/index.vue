<template>
	<PageContainer>
		<section aria-labelledby="records-title" class="flex flex-col gap-6">
			<UButton to="/zones" variant="ghost" color="neutral" icon="i-clarity-undo-line" class="self-start">
				Back to Zones
			</UButton>

			<header class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
				<div class="min-w-0">
					<p class="text-primary text-xs font-semibold tracking-wide uppercase">DNS Zone</p>
					<div class="mt-1 flex min-w-0 items-center gap-2">
						<h1
							id="records-title"
							class="text-highlighted truncate text-2xl font-semibold tracking-tight sm:text-3xl"
						>
							{{ zoneName || 'DNS Records' }}
						</h1>
						<UButton
							v-if="zoneName"
							:to="`https://${zoneName}`"
							external
							target="_blank"
							rel="noopener noreferrer"
							variant="ghost"
							color="neutral"
							size="xs"
							icon="i-heroicons-arrow-top-right-on-square"
							:aria-label="`Open ${zoneName} in a new tab`"
						/>
					</div>
					<p class="text-muted mt-2 text-sm">
						Search, edit, import, and protect this zone’s DNS configuration.
					</p>
				</div>

				<div class="flex flex-wrap items-center gap-2">
					<UButton color="primary" icon="i-clarity-plus-circle-solid" @click="navigateToCreate">
						Create Record
					</UButton>
					<AiDnsEditorModal
						:api-key="apiKey"
						:zone-id="zoneId"
						:zone-name="zoneName"
						@applied="handleAiApplied"
					/>
					<UDropdownMenu :items="moreNavItems" :content="{ align: 'end' }">
						<UButton
							variant="outline"
							color="neutral"
							icon="i-heroicons-squares-2x2"
							trailing-icon="i-heroicons-chevron-down-20-solid"
						>
							More Actions
						</UButton>
					</UDropdownMenu>
				</div>
			</header>

			<div class="flex flex-wrap items-center gap-3">
				<CapabilityIndicator :missing-items="capabilityMissing" />
				<UTooltip
					v-if="canBotFight"
					:text="
						botUnavailable
							? botUnavailableReason || 'Bot Fight Mode is unavailable'
							: 'Toggle Bot Fight Mode'
					"
				>
					<div
						class="border-default bg-default flex items-center gap-3 rounded-lg border px-3 py-2 shadow-xs"
					>
						<UIcon name="i-heroicons-bug-ant" class="text-muted h-5 w-5" aria-hidden="true" />
						<span class="text-highlighted text-sm font-medium">Bot Fight Mode</span>
						<UBadge v-if="botUnavailable" color="neutral" variant="subtle">Unavailable</UBadge>
						<UBadge v-else :color="botFightMode ? 'success' : 'neutral'" variant="subtle">
							{{ botFightMode ? 'On' : 'Off' }}
						</UBadge>
						<UIcon
							v-if="botLoading"
							name="i-heroicons-arrow-path"
							class="text-muted h-4 w-4 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>
						<USwitch
							:model-value="botFightMode"
							:disabled="botLoading || botUnavailable"
							aria-label="Toggle Bot Fight Mode"
							@update:model-value="updateBotFightMode"
						/>
					</div>
				</UTooltip>

				<UDropdownMenu v-if="canSsl" :items="sslMenuItems" :content="{ align: 'start' }">
					<UButton
						variant="outline"
						color="neutral"
						icon="i-clarity-lock-line"
						trailing-icon="i-heroicons-chevron-down-20-solid"
						:loading="sslUpdating"
					>
						SSL: {{ sslLabel }}
					</UButton>
				</UDropdownMenu>
			</div>

			<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<div v-for="stat in recordStats" :key="stat.label" class="surface-panel p-4">
					<p class="text-muted text-xs font-medium">{{ stat.label }}</p>
					<p class="text-highlighted mt-1 text-xl font-semibold tabular-nums">{{ stat.value }}</p>
				</div>
			</div>

			<div v-if="zone.name_servers?.length" class="flex flex-wrap items-center gap-2">
				<span class="text-muted text-xs font-semibold tracking-wide uppercase">Nameservers</span>
				<UButton
					v-for="ns in zone.name_servers"
					:key="ns"
					variant="soft"
					color="neutral"
					size="sm"
					trailing-icon="i-clarity-clipboard-line"
					:aria-label="`Copy nameserver ${ns}`"
					class="font-mono text-xs"
					@click="copyToClipboard(ns, 'Nameserver')"
				>
					{{ ns }}
				</UButton>
			</div>

			<UBadge v-if="searchQuery || selectedStatus.length" color="primary" variant="subtle" class="self-start">
				<span v-if="searchQuery">Search: {{ searchQuery }}</span>
				<span v-if="selectedStatus.length">Types: {{ selectedStatus.join(', ') }}</span>
				<UButton
					variant="ghost"
					color="primary"
					size="xs"
					icon="i-heroicons-x-mark"
					aria-label="Clear all record filters"
					@click="clearFilters"
				/>
			</UBadge>
			<div class="flex w-full flex-col gap-4">
				<UAlert
					v-if="dnsLoadError"
					color="error"
					variant="subtle"
					icon="i-heroicons-exclamation-triangle"
					title="Couldn’t Load DNS Records"
					:description="dnsLoadError"
				>
					<template #actions>
						<UButton color="error" variant="soft" size="sm" :loading="loading" @click="retryDns">
							Try Again
						</UButton>
					</template>
				</UAlert>

				<div class="surface-panel flex w-full flex-col gap-4 p-4 lg:flex-row lg:items-end lg:justify-between">
					<div class="grid w-full gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] lg:max-w-2xl lg:flex-1">
						<UFormField label="Record Types" name="record-types">
							<USelectMenu
								v-model="selectedStatus"
								:items="dnsTypes"
								multiple
								placeholder="All types…"
								aria-label="Filter by record type"
								class="w-full"
							/>
						</UFormField>
						<UFormField label="Search Records" name="record-search">
							<div class="relative min-w-0">
								<UTooltip text="Press '/' to search">
									<UInput
										id="record-search"
										ref="searchInput"
										v-model="searchQuery"
										name="record-search"
										autocomplete="off"
										:spellcheck="false"
										icon="i-heroicons-magnifying-glass-20-solid"
										type="search"
										placeholder="Search names and values…"
										color="neutral"
										class="w-full min-w-0 transition-shadow focus-within:shadow-md"
										size="lg"
										:ui="{ base: 'pe-11' }"
										@focus="focusRecordSearch"
									/>
								</UTooltip>
								<UButton
									v-if="searchQuery"
									variant="ghost"
									color="neutral"
									size="xs"
									icon="i-heroicons-x-mark-20-solid"
									aria-label="Clear record search"
									class="absolute top-1.5 right-1.5"
									@click="searchQuery = ''"
								/>
							</div>
						</UFormField>
					</div>
					<div class="flex w-full flex-wrap items-end gap-2 lg:w-auto lg:justify-end">
						<UFormField label="Rows" name="page-size">
							<USelect
								v-model="pageSize"
								:items="pageSizeOptions"
								aria-label="Records per page"
								class="w-32"
							/>
						</UFormField>
						<UButton
							v-if="selectedRecordIds.length"
							color="error"
							variant="outline"
							icon="i-heroicons-trash-20-solid"
							class="grow sm:grow-0"
							@click="openDeleteModal(selectedRecords)"
						>
							Delete {{ selectedRecordIds.length }}
						</UButton>
						<UDropdownMenu :items="columnPickerItems" :content="{ align: 'end' }">
							<UButton
								label="Columns"
								color="neutral"
								variant="outline"
								trailing-icon="i-heroicons-chevron-down-20-solid"
								class="grow sm:grow-0"
							/>
						</UDropdownMenu>
					</div>
				</div>
				<UTable
					v-if="!dnsLoadError"
					v-model:column-visibility="columnVisibility"
					:data="rows"
					:columns="columns"
					:loading="loading"
					class="border-default bg-default w-full overflow-x-auto rounded-xl border"
					:ui="{
						tr: {
							base: 'even:bg-comet-100 dark:even:bg-comet-950/50 hover:bg-comet-200 dark:hover:bg-comet-800'
						},
						td: {
							color: 'text-comet-700 dark:text-comet-200'
						}
					}"
				>
					<template #select-header>
						<UCheckbox
							:model-value="selectAllState"
							aria-label="Select all visible DNS records"
							@click.stop
							@update:model-value="(value) => toggleSelectAllVisible(value === true)"
						/>
					</template>
					<template #select-cell="{ row }">
						<UCheckbox
							:model-value="selectedRecordIds.includes(row.original.id)"
							:aria-label="`Select ${row.original._displayName}`"
							@click.stop
							@update:model-value="(value) => toggleRecordSelection(row.original, value === true)"
						/>
					</template>
					<template #type-cell="{ row }">
						<div class="flex items-center gap-2">
							<UBadge :color="getRecordTypeColor(row.original.type)" class="uppercase">
								{{ row.original.type }}
							</UBadge>
							<UTooltip
								v-if="row.original.type === 'SRV'"
								text="Service Record - Maps services to hostnames and ports"
							>
								<UIcon name="i-heroicons-question-mark-circle" class="text-comet-500 h-4 w-4" />
							</UTooltip>
						</div>
					</template>
					<template #name-cell="{ row }">
						<div
							class="group flex max-w-[120px] min-w-0 items-center gap-2 overflow-hidden sm:max-w-[200px]"
						>
							<UIcon
								:name="getRecordTypeIcon(row.original.type)"
								class="text-comet-500 h-4 w-4 shrink-0"
							/>
							<NuxtLink
								:to="getRecordDestination(row.original.id)"
								:aria-label="`Edit ${row.original._displayName}`"
								class="focus-visible:ring-primary min-w-0 truncate rounded text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none md:text-sm"
								@click="rememberRecord(row.original.id)"
							>
								{{ row.original._displayName }}
							</NuxtLink>
							<UButton
								icon="i-heroicons-arrow-top-right-on-square"
								variant="ghost"
								color="neutral"
								size="xs"
								aria-label="Open record host in new tab"
								@click.stop="openRecordUrl(row.original)"
							/>
						</div>
					</template>
					<template #content-cell="{ row }">
						<div
							class="group flex max-w-[140px] items-center gap-2 overflow-hidden sm:max-w-[200px] md:max-w-[280px] lg:max-w-[360px]"
						>
							<NuxtLink
								:to="getRecordDestination(row.original.id)"
								:aria-label="`Edit record ${row.original._displayName}`"
								class="focus-visible:ring-primary min-w-0 truncate rounded text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none md:text-sm"
								@click="rememberRecord(row.original.id)"
							>
								{{ row.original._displayContent }}
							</NuxtLink>
							<UButton
								icon="i-clarity-clipboard-line"
								variant="ghost"
								color="neutral"
								size="xs"
								class="sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
								:aria-label="`Copy value of ${row.original._displayName}`"
								@click.stop="copyToClipboard(row.original._displayContent, 'Record value')"
							/>
							<div v-if="row.original.proxiable" @click.stop>
								<USwitch
									v-model="row.original.proxied"
									color="primary"
									:disabled="proxyPending.has(row.original.id)"
									:aria-label="`Toggle Cloudflare proxy for ${row.original._displayName}`"
									@update:model-value="() => updateProxyStatus(row.original)"
								/>
							</div>
						</div>
					</template>
					<template #created_on-cell="{ row }">
						<p class="truncate text-xs md:text-sm">
							{{ formatDate(row.original.created_on) }}
						</p>
					</template>
					<template #modified_on-cell="{ row }">
						<p class="truncate text-xs md:text-sm">
							{{ formatDate(row.original.modified_on) }}
						</p>
					</template>
					<template #actions-cell="{ row }">
						<UDropdownMenu :items="items(row.original)">
							<UButton
								color="neutral"
								variant="ghost"
								icon="i-heroicons-ellipsis-horizontal-20-solid"
								aria-label="Record actions"
								@click.stop
							/>
						</UDropdownMenu>
					</template>
					<template #empty>
						<div class="flex flex-col items-center justify-center gap-3 py-10 text-center">
							<UIcon name="i-clarity-list-line" class="text-comet-400 h-8 w-8" />
							<p class="text-comet-600 dark:text-comet-300 text-sm">
								{{
									hasActiveFilters
										? 'No records match your filters.'
										: 'This zone has no DNS records yet.'
								}}
							</p>
							<UButton
								v-if="hasActiveFilters"
								variant="outline"
								color="neutral"
								icon="i-heroicons-x-mark-20-solid"
								@click="clearFilters"
							>
								Clear Filters
							</UButton>
							<UButton
								v-else
								color="primary"
								icon="i-clarity-plus-circle-solid"
								@click="navigateToCreate"
							>
								Create Record
							</UButton>
						</div>
					</template>
				</UTable>
				<div v-if="!dnsLoadError && filteredRecords.length > pageSize" class="flex w-full justify-end">
					<UPagination v-model:page="page" :items-per-page="pageSize" :total="filteredRecords.length" />
				</div>
				<UModal v-model:open="deleteModalOpen">
					<template #title>
						<div class="flex items-center gap-2">
							<UIcon name="i-heroicons-exclamation-triangle" class="h-5 w-5 text-red-500" />
							<span>Delete Records?</span>
						</div>
					</template>
					<template #description>
						<p class="text-comet-600 dark:text-comet-300 text-sm">
							This will permanently delete
							<span class="font-semibold">{{ deleteTargets.length }}</span>
							record{{ deleteTargets.length === 1 ? '' : 's' }} from
							<span class="font-semibold">{{ zoneName || 'this zone' }}</span
							>.
						</p>
					</template>
					<template #body>
						<div class="space-y-4">
							<div
								class="border-comet-200 bg-comet-50 dark:border-comet-700 dark:bg-comet-900 rounded-md border p-3 text-xs"
							>
								<div class="space-y-2">
									<div
										v-for="record in deletePreview"
										:key="record.id"
										class="flex items-center gap-2"
									>
										<UBadge :color="getRecordTypeColor(record.type)" class="uppercase">{{
											record.type
										}}</UBadge>
										<span class="truncate">{{ record._displayName }}</span>
										<span class="text-comet-400">→</span>
										<span class="truncate">{{ record._displayContent }}</span>
									</div>
								</div>
								<div v-if="deleteTargets.length > deletePreview.length" class="text-comet-500 mt-2">
									+{{ deleteTargets.length - deletePreview.length }} more
								</div>
							</div>
							<p class="text-comet-500 dark:text-comet-400 text-xs">This action cannot be undone.</p>
						</div>
					</template>
					<template #footer>
						<div class="flex w-full justify-end gap-3">
							<UButton color="neutral" variant="ghost" @click="closeDeleteModal">Cancel</UButton>
							<UButton color="error" :loading="deleteLoading" @click="confirmDelete"
								>Delete Records</UButton
							>
						</div>
					</template>
				</UModal>

				<UModal v-model:open="sslConfirmOpen">
					<template #title>Lower SSL Protection?</template>
					<template #description>
						Changing to
						<span class="text-highlighted font-semibold capitalize">{{ pendingSslMode }}</span> can weaken
						visitor-to-origin encryption for {{ zoneName }}.
					</template>
					<template #body>
						<p class="text-muted text-sm">
							Only continue if your origin cannot support Full or Strict mode. You can change this again
							later.
						</p>
					</template>
					<template #footer>
						<div class="flex w-full justify-end gap-3">
							<UButton color="neutral" variant="ghost" @click="sslConfirmOpen = false"
								>Keep Current Mode</UButton
							>
							<UButton color="error" :loading="sslUpdating" @click="confirmSslChange">
								Use {{ pendingSslMode === 'off' ? 'Off' : 'Flexible' }}
							</UButton>
						</div>
					</template>
				</UModal>

				<UModal v-model:open="importModalOpen">
					<template #title>
						<div class="flex items-center gap-2">
							<UIcon name="i-heroicons-arrow-up-tray" class="h-5 w-5" />
							<span>Import BIND Zone File</span>
						</div>
					</template>
					<template #description>
						<p class="text-comet-600 dark:text-comet-300 text-sm">
							Paste or upload a BIND zone file. Records are added to
							<span class="font-semibold">{{ zoneName || 'this zone' }}</span> via Cloudflare's importer.
						</p>
					</template>
					<template #body>
						<div class="space-y-3">
							<input
								type="file"
								accept=".txt,.zone,text/plain"
								aria-label="Upload BIND zone file"
								class="text-comet-600 dark:text-comet-300 block w-full text-sm"
								@change="onImportFile"
							/>
							<UTextarea
								v-model="importText"
								:rows="10"
								placeholder="$ORIGIN example.com.&#10;www 1 IN A 192.0.2.1…"
								class="w-full font-mono text-xs"
							/>
						</div>
					</template>
					<template #footer>
						<div class="flex w-full justify-end gap-3">
							<UButton color="neutral" variant="ghost" @click="importModalOpen = false">Cancel</UButton>
							<UButton
								color="primary"
								:loading="importLoading"
								:disabled="!importText.trim()"
								@click="importZone"
							>
								Import Records
							</UButton>
						</div>
					</template>
				</UModal>
			</div>
		</section>
	</PageContainer>
</template>

<script setup>
import { useDebounceFn } from '@vueuse/core'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { getApiKey } = useSession()
const { getRecordTypeColor, getRecordTypeIcon, formatContent, getExpectedDnsValue } = useRecordTypes()
const zoneId = computed(() => route.params.zone_id)
const apiKey = ref('')
const zoneName = ref('')
const dnsRecords = ref([])
const zone = ref({})
const loading = ref(true)
const searchQuery = ref('')
const page = ref(1)
const pageSize = ref(50)
const recordsCacheTtl = 30000
const recordsCache = useState('records-cache', () => ({}))
const pageSizeOptions = [
	{ label: '10 per page', value: 10 },
	{ label: '25 per page', value: 25 },
	{ label: '50 per page', value: 50 },
	{ label: '100 per page', value: 100 }
]
const selectedRecordIds = ref([])
const deleteModalOpen = ref(false)
const deleteTargets = ref([])
const deleteLoading = ref(false)
const selectedStatus = ref([])
const proxyPending = ref(new Set())
const exportLoading = ref(false)
const importModalOpen = ref(false)
const importText = ref('')
const importLoading = ref(false)
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
	day: '2-digit',
	month: 'short',
	year: 'numeric'
})
const formatDate = (value) => {
	if (!value) return '—'
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date)
}
const windowSize = useWindowSize()
const isLargeScreen = computed(() => windowSize.width.value >= 768)
const botFightMode = ref(false)
const botLoading = ref(false)
const botUnavailable = ref(false)
const botUnavailableReason = ref('')
const sslUpdating = ref(false)
const sslConfirmOpen = ref(false)
const pendingSslMode = ref('')
const dnsLoadError = ref('')
const capabilities = ref(null)
const capabilityMissing = ref([])
const dnsRequestBody = computed(() => ({ apiKey: apiKey.value, currZone: zoneId.value }))
const zoneRequestBody = computed(() => ({ apiKey: apiKey.value, currZone: zoneId.value }))
const {
	data: dnsData,
	error: dnsError,
	refresh: refreshDns
} = useFetch('/api/records', {
	method: 'POST',
	body: dnsRequestBody,
	server: false,
	immediate: false
})
const {
	data: zoneData,
	error: zoneError,
	refresh: refreshZone
} = useFetch('/api/zone', {
	method: 'POST',
	body: zoneRequestBody,
	server: false,
	immediate: false
})
const {
	data: botData,
	error: botError,
	refresh: refreshBot
} = useFetch('/api/bot_management', {
	method: 'POST',
	body: zoneRequestBody,
	server: false,
	immediate: false
})
const canSsl = computed(() => Boolean(capabilities.value && capabilities.value.ssl && capabilities.value.ssl.available))
const canBotFight = computed(() =>
	Boolean(capabilities.value && capabilities.value.botFightMode && capabilities.value.botFightMode.available)
)
const canRulesets = computed(() =>
	Boolean(capabilities.value && capabilities.value.rulesets && capabilities.value.rulesets.available)
)
const canTurnstile = computed(() =>
	Boolean(capabilities.value && capabilities.value.turnstile && capabilities.value.turnstile.available)
)
const canDnsViews = computed(() =>
	Boolean(capabilities.value && capabilities.value.dnsViews && capabilities.value.dnsViews.available)
)
const canDnsFirewall = computed(() =>
	Boolean(capabilities.value && capabilities.value.dnsFirewall && capabilities.value.dnsFirewall.available)
)
const canAccountAnalytics = computed(() =>
	Boolean(capabilities.value && capabilities.value.accountAnalytics && capabilities.value.accountAnalytics.available)
)
const moreNavItems = computed(() => {
	const tools = [
		{
			label: exportLoading.value ? 'Exporting Zone…' : 'Export Zone',
			icon: 'i-heroicons-arrow-down-tray',
			disabled: exportLoading.value,
			onSelect: exportZone
		},
		{
			label: 'Import Zone File',
			icon: 'i-heroicons-arrow-up-tray',
			onSelect: () => {
				importModalOpen.value = true
			}
		},
		{
			label: 'DNS Lookup',
			icon: 'i-heroicons-globe-alt',
			to: {
				path: '/tools/dns-lookup',
				query: { name: zoneName.value || undefined, type: 'ALL', zone: zoneId.value }
			}
		}
	]
	const items = []
	if (canRulesets.value)
		items.push({ label: 'Rules', icon: 'i-heroicons-shield-check', to: `/zones/${zoneId.value}/rules` })
	if (canAccountAnalytics.value)
		items.push({ label: 'Analytics', icon: 'i-heroicons-chart-bar', to: `/zones/${zoneId.value}/analytics` })
	if (canTurnstile.value)
		items.push({
			label: 'Turnstile',
			icon: 'i-heroicons-shield-exclamation',
			to: `/zones/${zoneId.value}/turnstile`
		})
	if (canDnsViews.value)
		items.push({ label: 'DNS Views', icon: 'i-heroicons-squares-plus', to: `/zones/${zoneId.value}/dns-views` })
	if (canDnsFirewall.value)
		items.push({
			label: 'DNS Firewall',
			icon: 'i-heroicons-shield-check',
			to: `/zones/${zoneId.value}/dns-firewall`
		})
	return items.length ? [tools, items] : [tools]
})

const sslLabel = computed(() => {
	const value = zone.value?.ssl?.value
	if (!value) return 'Unknown'
	return value.charAt(0).toUpperCase() + value.slice(1)
})
const getRecordsCacheKey = () => `${apiKey.value}:${zoneId.value}`
const getRecordsUpdatedKey = () => `cf-records-updated-${zoneId.value}`
const readRecordsCache = () => {
	const key = getRecordsCacheKey()
	return recordsCache.value[key]
}
const writeRecordsCache = (records) => {
	const key = getRecordsCacheKey()
	if (!key || !zoneId.value) return
	recordsCache.value[key] = { records, fetchedAt: Date.now() }
}
const markRecordsUpdated = () => {
	if (!zoneId.value) return
	localStorage.setItem(getRecordsUpdatedKey(), String(Date.now()))
}

const seoZoneLabel = computed(() => zoneName.value || zone.value?.name || zoneId.value || 'Zone')
useDynamicSeo({
	title: computed(() => `${seoZoneLabel.value}`),
	description: computed(() => `Manage DNS records for ${seoZoneLabel.value}.`)
})

const updateProxyStatus = async (record) => {
	// v-model has already flipped record.proxied to the desired value; remember the
	// prior state so we can roll back if Cloudflare rejects the change.
	const previous = !record.proxied
	const pending = new Set(proxyPending.value)
	pending.add(record.id)
	proxyPending.value = pending

	const stopPending = () => {
		const next = new Set(proxyPending.value)
		next.delete(record.id)
		proxyPending.value = next
	}

	try {
		const data = await $fetch('/api/update_record', {
			method: 'POST',
			body: {
				apiKey: apiKey.value,
				currZone: zoneId.value,
				currDnsRecord: record.id,
				dns: { ...record, proxied: record.proxied === true }
			}
		})
		if (data?.success) {
			toast.add({
				id: 'update-proxy-success' + Date.now(),
				title: 'Proxy updated',
				description: `Proxy ${record.proxied ? 'enabled' : 'disabled'} for ${record._displayName || record.name}`,
				icon: 'i-clarity-check-circle-solid',
				duration: 3000,
				color: 'success'
			})
			markRecordsUpdated()
			await getDns({ force: true })
			return
		}
		record.proxied = previous
		toast.add({
			id: 'update-proxy-error' + Date.now(),
			title: 'Update failed',
			description: data?.errors?.[0]?.message || 'Failed to update proxy status',
			icon: 'i-clarity-warning-solid',
			duration: 4000,
			color: 'error'
		})
	} catch (error) {
		record.proxied = previous
		toast.add({
			id: 'update-proxy-error' + Date.now(),
			title: 'Update failed',
			description: error?.data?.statusMessage || error?.message || 'Failed to update proxy status',
			icon: 'i-clarity-warning-solid',
			duration: 4000,
			color: 'error'
		})
	} finally {
		stopPending()
	}
}

const updateSslSetting = async (sslMode) => {
	sslUpdating.value = true
	try {
		const data = await $fetch('/api/update_ssl', {
			method: 'POST',
			body: {
				apiKey: apiKey.value,
				currZone: zoneId.value,
				ssl: sslMode
			}
		})
		if (!data?.success) throw new Error(data?.errors?.[0]?.message || 'Cloudflare rejected the SSL change')
		toast.add({
			id: 'update-ssl-success' + Date.now(),
			title: 'SSL Mode Updated',
			description: `SSL mode is now ${sslMode}.`,
			icon: 'i-clarity-check-circle-solid',
			duration: 3000,
			color: 'success'
		})
		await getAll()
	} catch (error) {
		toast.add({
			id: 'update-ssl-error' + Date.now(),
			title: 'SSL Update Failed',
			description: error?.data?.statusMessage || error?.message || 'Try the SSL change again.',
			icon: 'i-clarity-warning-solid',
			duration: 4000,
			color: 'error'
		})
	} finally {
		sslUpdating.value = false
		pendingSslMode.value = ''
	}
}

const requestSslSetting = (sslMode) => {
	if (sslMode === 'flexible' || sslMode === 'off') {
		pendingSslMode.value = sslMode
		sslConfirmOpen.value = true
		return
	}
	updateSslSetting(sslMode)
}

const confirmSslChange = async () => {
	const mode = pendingSslMode.value
	sslConfirmOpen.value = false
	if (mode) await updateSslSetting(mode)
}

const sslMenuItems = computed(() => [
	{
		label: 'Strict',
		icon: 'i-clarity-lock-solid',
		onSelect: () => requestSslSetting('strict')
	},
	{
		label: 'Full',
		icon: 'i-clarity-lock-line',
		onSelect: () => requestSslSetting('full')
	},
	{
		label: 'Flexible',
		icon: 'i-clarity-curve-chart-solid',
		onSelect: () => requestSslSetting('flexible')
	},
	{
		label: 'Off',
		icon: 'i-clarity-no-access-solid',
		onSelect: () => requestSslSetting('off')
	}
])

const getBotManagement = async () => {
	botLoading.value = true
	botUnavailable.value = false
	botUnavailableReason.value = ''
	try {
		await refreshBot()
		if (botError.value) throw botError.value
		const data = botData.value
		if (!data || !data.success) {
			botUnavailable.value = true
			botUnavailableReason.value = data?.errors?.[0]?.message || 'Failed to load Bot Fight Mode'
			return
		}

		const fight = data?.result?.fight_mode
		if (typeof fight === 'boolean') {
			botFightMode.value = fight
			return
		}

		if (typeof fight === 'string') {
			if (fight === 'on' || fight === 'true') {
				botFightMode.value = true
				return
			}
			if (fight === 'off' || fight === 'false') {
				botFightMode.value = false
				return
			}
		}

		botUnavailable.value = true
		botUnavailableReason.value = 'fight_mode not present in response'
	} catch (error) {
		botUnavailable.value = true
		botUnavailableReason.value =
			error?.data?.statusMessage || error?.statusMessage || 'Failed to load Bot Fight Mode'
	} finally {
		botLoading.value = false
	}
}

const updateBotFightMode = async (value) => {
	const previous = botFightMode.value
	botFightMode.value = value
	botLoading.value = true
	try {
		const response = await fetch('/api/update_bot_fight_mode', {
			method: 'POST',
			body: JSON.stringify({
				apiKey: apiKey.value,
				currZone: zoneId.value,
				fight_mode: value
			})
		})

		const data = await response.json()
		if (!data.success) {
			botFightMode.value = previous
			toast.add({
				id: 'bot-fight-mode-error' + Date.now(),
				title: 'Update failed',
				description: data.errors?.[0]?.message || 'Failed to update Bot Fight Mode',
				icon: 'i-clarity-warning-solid',
				duration: 4000,
				color: 'error'
			})
			return
		}

		toast.add({
			id: 'bot-fight-mode-success' + Date.now(),
			title: 'Updated',
			description: `Bot Fight Mode ${value ? 'enabled' : 'disabled'}`,
			icon: 'i-clarity-check-circle-solid',
			duration: 2500,
			color: 'success'
		})
	} catch (e) {
		botFightMode.value = previous
		toast.add({
			id: 'bot-fight-mode-error' + Date.now(),
			title: 'Update failed',
			description: e.message || 'Failed to update Bot Fight Mode',
			icon: 'i-clarity-warning-solid',
			duration: 4000,
			color: 'error'
		})
	} finally {
		botLoading.value = false
	}
}

const dnsTypes = computed(() => {
	if (!dnsRecords.value) return []
	return dnsRecords.value
		.filter((record) => record && record.type)
		.map((record) => record.type)
		.filter((value, index, self) => self.indexOf(value) === index)
})

const columns = [
	{
		id: 'select',
		header: '',
		enableSorting: false
	},
	{
		id: 'type',
		accessorKey: 'type',
		header: 'Type'
	},
	{
		id: 'name',
		accessorKey: '_displayName',
		header: 'Name'
	},
	{
		id: 'content',
		accessorKey: '_displayContent',
		header: 'Content'
	},
	{
		id: 'created_on',
		accessorKey: 'created_on',
		header: 'Created'
	},
	{
		id: 'modified_on',
		accessorKey: 'modified_on',
		header: 'Modified'
	},
	{
		id: 'actions',
		header: 'Actions',
		enableSorting: false
	}
]

const columnVisibility = ref({})
const columnPickerItems = computed(() =>
	columns
		.filter((column) => column.header)
		.map((column) => ({
			label: column.header,
			type: 'checkbox',
			checked: columnVisibility.value[column.id] !== false,
			onUpdateChecked(checked) {
				columnVisibility.value[column.id] = checked
			},
			onSelect(e) {
				e.preventDefault()
			}
		}))
)

// Proxied records resolve to Cloudflare's edge, so only pass an expected value for
// records the public answer should match verbatim.
const propagationLink = (record) => {
	const query = { name: record.name, type: record.type, zone: zoneId.value }
	if (record.proxied) query.proxied = '1'
	else {
		const expected = getExpectedDnsValue(record)
		if (expected) query.expected = expected
	}
	return { path: '/tools/propagation', query }
}

const items = (row) => {
	return [
		[
			{
				label: 'Edit',
				icon: 'i-heroicons-pencil-square-20-solid',
				onSelect: () => navigateToRecord(row.id)
			},
			{
				label: 'Copy value',
				icon: 'i-clarity-clipboard-line',
				onSelect: () => copyToClipboard(formatContent(row), 'Record value')
			},
			{
				label: 'Check Propagation',
				icon: 'i-heroicons-signal',
				to: propagationLink(row)
			},
			{
				label: 'Open',
				icon: 'i-heroicons-arrow-top-right-on-square',
				onSelect: () => openRecordUrl(row)
			},
			{
				label: row.proxiable ? 'Proxiable' : 'Not Proxiable',
				disabled: true,
				icon: row.proxiable ? 'i-heroicons-check-circle-20-solid' : 'i-heroicons-x-circle-20-solid'
			}
		],
		[
			{
				label: 'Delete',
				icon: 'i-heroicons-trash-20-solid',
				color: 'error',
				onSelect: () => openDeleteModal(row)
			}
		]
	]
}

const formatDisplayName = (record) => {
	// First handle SRV records with special logic
	if (record.type === 'SRV') {
		return formatSrvRecordName(record)
	}

	// For standard records, handle zone name trimming
	const name = record.name
	if (!name) return ''

	// Apex record, or a name that isn't actually a subdomain of the zone.
	if (name === zoneName.value || !name.endsWith(`.${zoneName.value}`)) {
		return name === zoneName.value ? '@' : name
	}

	// Remove zone name and the preceding dot
	return name.slice(0, -zoneName.value.length - 1)
}

// Add a computed property for processed records to avoid repeated calculations
const processedRecords = computed(() => {
	if (!dnsRecords.value || !zoneName.value) return []

	return dnsRecords.value.map((record) => ({
		...record,
		_displayName: formatDisplayName(record),
		_displayContent: formatContent(record)
	}))
})

const filteredRecords = computed(() => {
	let records = processedRecords.value || []

	if (selectedStatus.value.length > 0) {
		records = records.filter((record) => selectedStatus.value.includes(record.type))
	}

	if (searchQuery.value) {
		const query = searchQuery.value.toLowerCase()
		records = records.filter((record) => {
			return (
				(record.name && record.name.toLowerCase().includes(query)) ||
				(record.content && record.content.toLowerCase().includes(query)) ||
				(record.comment && record.comment.toLowerCase().includes(query))
			)
		})
	}

	return records
})

const hasActiveFilters = computed(() => Boolean(searchQuery.value || selectedStatus.value.length))
const totalRecords = computed(() => (dnsRecords.value || []).length)
const filteredCount = computed(() => (filteredRecords.value || []).length)
const proxiedCount = computed(() => (dnsRecords.value || []).filter((r) => r && r.proxied === true).length)
const typesCount = computed(() => (dnsTypes.value || []).length)
const recordStats = computed(() => [
	{ label: 'Records', value: totalRecords.value },
	{ label: 'Filtered', value: filteredCount.value },
	{ label: 'Proxied', value: proxiedCount.value },
	{ label: 'Record Types', value: typesCount.value }
])
const pageCount = computed(() => Math.max(1, Math.ceil(filteredRecords.value.length / pageSize.value)))

const selectedRecords = computed(() => {
	const ids = selectedRecordIds.value
	if (!ids.length) return []
	return processedRecords.value.filter((record) => ids.includes(record.id))
})

const allVisibleSelected = computed(() => {
	if (!rows.value.length) return false
	return rows.value.every((row) => selectedRecordIds.value.includes(row.id))
})

const someVisibleSelected = computed(() => {
	if (!rows.value.length) return false
	return rows.value.some((row) => selectedRecordIds.value.includes(row.id)) && !allVisibleSelected.value
})

const selectAllState = computed(() => {
	if (allVisibleSelected.value) return true
	if (someVisibleSelected.value) return 'indeterminate'
	return false
})

const deletePreview = computed(() => deleteTargets.value.slice(0, 6))

const rows = computed(() => {
	const startIndex = (page.value - 1) * pageSize.value
	const endIndex = startIndex + pageSize.value
	return filteredRecords.value.slice(startIndex, endIndex)
})

// Add watch to update URL when filter changes
watch(
	selectedStatus,
	(newValue) => {
		page.value = 1
		if (newValue.length) {
			router.push({
				query: {
					...route.query,
					types: newValue.join(',')
				}
			})
		} else if (route.query.types) {
			// Remove the types param if no filters are selected
			const { types: _types, ...restQuery } = route.query
			router.push({ query: restQuery })
		}
	},
	{ deep: true }
)

// Add debounced function to update URL when search changes
const debouncedUpdateSearchQuery = useDebounceFn((newValue) => {
	if (newValue) {
		router.push({
			query: {
				...route.query,
				search: newValue
			}
		})
	} else if (route.query.search) {
		// Remove the search param if query is empty
		const { search: _search, ...restQuery } = route.query
		router.push({ query: restQuery })
	}
}, 300)

// Watch search query changes
watch(searchQuery, (newValue) => {
	page.value = 1
	debouncedUpdateSearchQuery(newValue)
})

watch(pageSize, () => {
	page.value = 1
})

// Add watch to update URL when page changes
watch(page, (newValue) => {
	if (newValue > 1) {
		router.push({
			query: {
				...route.query,
				page: newValue.toString()
			}
		})
	} else if (route.query.page) {
		// Remove the page param if on page 1
		const { page: _page, ...restQuery } = route.query
		router.push({ query: restQuery })
	}
})

watch(filteredRecords, () => {
	if (page.value > pageCount.value) {
		page.value = pageCount.value
	}
})

// Initialize from URL params
onMounted(async () => {
	apiKey.value = getApiKey()
	if (!apiKey.value) return

	// On small screens hide the date columns by default to reduce horizontal crowding.
	if (!isLargeScreen.value) columnVisibility.value = { created_on: false, modified_on: false }

	// Check if we have types in the URL
	if (route.query.types) {
		const typesParam = route.query.types
		selectedStatus.value = typesParam.includes(',') ? typesParam.split(',') : [typesParam]
	}

	// Check if we have search in the URL
	if (route.query.search) {
		searchQuery.value = route.query.search
	}

	// Check if we have page in the URL
	if (route.query.page) {
		const pageNum = parseInt(route.query.page)
		if (!isNaN(pageNum) && pageNum > 0) {
			page.value = pageNum
		}
	}

	// Add keyboard shortcut for search
	window.addEventListener('keydown', handleKeyDown)

	await getAll()
})

onUnmounted(() => {
	// Remove event listener when component is unmounted
	window.removeEventListener('keydown', handleKeyDown)
})

const focusRecordSearch = () => {
	setTimeout(() => document.getElementById('record-search')?.select(), 50)
}

// Keyboard shortcut handler
const handleKeyDown = (e) => {
	// Focus search box when '/' is pressed and not in an input field
	if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
		e.preventDefault()
		document.getElementById('record-search')?.focus()
	}
}

const getDns = async ({ preferCache = true, force = false } = {}) => {
	dnsLoadError.value = ''
	try {
		if (!force && preferCache) {
			const cacheEntry = readRecordsCache()
			const lastMutation = Number(localStorage.getItem(getRecordsUpdatedKey()) || 0)
			const isValidCache = cacheEntry && cacheEntry.fetchedAt >= lastMutation
			const isFreshCache = isValidCache && Date.now() - cacheEntry.fetchedAt < recordsCacheTtl
			if (cacheEntry && isValidCache) {
				dnsRecords.value = cacheEntry.records || []
				if (isFreshCache) return
			}
		}
		await refreshDns()
		if (dnsError.value) throw dnsError.value
		const data = dnsData.value
		if (data?.success === false) {
			dnsLoadError.value = data.errors?.[0]?.message || 'Failed to get records'
			toast.add({
				id: 'get-records-failed' + Date.now(),
				title: 'Failed to get records',
				description: dnsLoadError.value,
				icon: 'i-clarity-warning-solid',
				duration: 3000,
				color: 'error'
			})
			dnsRecords.value = []
			return
		}

		dnsRecords.value = data?.result || []
		writeRecordsCache(dnsRecords.value)
	} catch (error) {
		dnsLoadError.value = error?.data?.statusMessage || error?.statusMessage || 'Failed to get records'
		toast.add({
			id: 'get-records-http-failed' + Date.now(),
			title: 'Failed to get records',
			description: dnsLoadError.value,
			icon: 'i-clarity-warning-solid',
			duration: 3000,
			color: 'error'
		})
	}
}

const retryDns = async () => {
	loading.value = true
	await getDns({ force: true })
	loading.value = false
}

const getZone = async () => {
	try {
		await refreshZone()
		if (zoneError.value) throw zoneError.value
		const data = zoneData.value
		if (data?.success && data.result) {
			zone.value = data.result
			zoneName.value = data.result.name
			if (data.result.account && data.result.account.id) {
				localStorage.setItem('cf-account-id', data.result.account.id)
				if (data.result.account.name) localStorage.setItem('cf-account-name', data.result.account.name)
			}
			return
		}
		console.error('Failed to load zone')
	} catch (error) {
		console.error('Failed to load zone', error)
	}
}

const getAll = async () => {
	loading.value = true
	await Promise.all([getZone(), getDns({ preferCache: true }), loadCapabilities()])
	if (canBotFight.value) await getBotManagement()
	loading.value = false
}

const loadCapabilities = async () => {
	try {
		const { loadZone, missing } = useCapabilities()
		const caps = await loadZone(apiKey.value, zoneId.value)
		capabilities.value = caps
		capabilityMissing.value = missing(caps)
	} catch {
		capabilities.value = null
		capabilityMissing.value = []
	}
}

const delDns = async (record) => {
	const response = await fetch('/api/delete_record', {
		method: 'POST',
		body: JSON.stringify({
			apiKey: apiKey.value,
			currZone: zoneId.value,
			currDnsRecord: record.id
		})
	})
	if (response.ok) {
		const data = await response.json()
		return data.success !== false
	}
	return false
}

const openDeleteModal = (records) => {
	deleteTargets.value = Array.isArray(records) ? records : [records]
	deleteModalOpen.value = true
}

const closeDeleteModal = () => {
	deleteModalOpen.value = false
	deleteTargets.value = []
}

const confirmDelete = async () => {
	if (!deleteTargets.value.length) return
	deleteLoading.value = true
	try {
		const results = await Promise.allSettled(deleteTargets.value.map((record) => delDns(record)))
		const successCount = results.filter((result) => result.status === 'fulfilled' && result.value).length
		const failedCount = results.length - successCount
		if (successCount > 0) {
			toast.add({
				id: 'delete-record-success' + Date.now(),
				title: 'Delete success',
				description: `${successCount} record${successCount === 1 ? '' : 's'} deleted`,
				icon: 'i-clarity-check-circle-solid',
				duration: 3000,
				color: 'success'
			})
			markRecordsUpdated()
			await getDns({ force: true })
			selectedRecordIds.value = selectedRecordIds.value.filter((id) =>
				dnsRecords.value.some((record) => record.id === id)
			)
		}
		if (failedCount > 0) {
			toast.add({
				id: 'delete-record-failed' + Date.now(),
				title: 'Delete failed',
				description: `${failedCount} record${failedCount === 1 ? '' : 's'} failed to delete`,
				icon: 'i-clarity-warning-solid',
				duration: 4000,
				color: 'error'
			})
		}
	} finally {
		deleteLoading.value = false
		closeDeleteModal()
	}
}

const rememberRecord = (recordId) => {
	localStorage.setItem('cf-dns-id', recordId)
	const record = dnsRecords.value.find((r) => r.id === recordId)
	if (record) localStorage.setItem('cf-dns-name', record.name)
}

const getRecordDestination = (recordId) => {
	const destination = { path: `/zones/${zoneId.value}/records/${recordId}` }
	if (Object.keys(route.query).length) {
		destination.query = { return: encodeURIComponent(JSON.stringify(route.query)) }
	}
	return destination
}

const navigateToRecord = (recordId) => {
	rememberRecord(recordId)
	router.push(getRecordDestination(recordId))
}

const toggleRecordSelection = (record, value) => {
	if (value) {
		if (!selectedRecordIds.value.includes(record.id)) {
			selectedRecordIds.value.push(record.id)
		}
		return
	}
	selectedRecordIds.value = selectedRecordIds.value.filter((id) => id !== record.id)
}

const toggleSelectAllVisible = (value) => {
	const visibleIds = rows.value.map((row) => row.id)
	if (value) {
		const merged = new Set([...selectedRecordIds.value, ...visibleIds])
		selectedRecordIds.value = Array.from(merged)
		return
	}
	selectedRecordIds.value = selectedRecordIds.value.filter((id) => !visibleIds.includes(id))
}

const openRecordUrl = (record) => {
	const base = record?.name || zoneName.value
	if (!base) return
	const url = base.startsWith('http://') || base.startsWith('https://') ? base : `https://${base}`
	window.open(url, '_blank', 'noopener,noreferrer')
}

const copyToClipboard = async (text, label = 'Value') => {
	if (!text) return
	try {
		await navigator.clipboard.writeText(text)
		toast.add({
			id: 'copy-clip' + Date.now(),
			title: 'Copied',
			description: `${label} copied to clipboard`,
			icon: 'i-clarity-check-circle-solid',
			duration: 2000,
			color: 'success'
		})
	} catch {
		toast.add({
			id: 'copy-clip-error' + Date.now(),
			title: 'Copy failed',
			description: 'Clipboard is unavailable in this browser',
			icon: 'i-clarity-warning-solid',
			duration: 3000,
			color: 'error'
		})
	}
}

const exportZone = async () => {
	exportLoading.value = true
	try {
		const data = await $fetch('/api/export_zone', {
			method: 'POST',
			body: { apiKey: apiKey.value, currZone: zoneId.value }
		})
		const zoneFile = data?.result?.zoneFile
		if (!zoneFile) throw new Error('Empty export')
		const blob = new Blob([zoneFile], { type: 'text/plain' })
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href = url
		link.download = `${zoneName.value || 'zone'}.zone`
		document.body.appendChild(link)
		link.click()
		link.remove()
		URL.revokeObjectURL(url)
		toast.add({
			id: 'export-zone-success' + Date.now(),
			title: 'Zone exported',
			description: `Downloaded ${zoneName.value || 'zone'}.zone`,
			icon: 'i-clarity-check-circle-solid',
			duration: 3000,
			color: 'success'
		})
	} catch (error) {
		toast.add({
			id: 'export-zone-error' + Date.now(),
			title: 'Export failed',
			description: error?.data?.statusMessage || error?.message || 'Failed to export zone',
			icon: 'i-clarity-warning-solid',
			duration: 4000,
			color: 'error'
		})
	} finally {
		exportLoading.value = false
	}
}

const onImportFile = async (event) => {
	const file = event?.target?.files?.[0]
	if (!file) return
	importText.value = await file.text()
}

const importZone = async () => {
	if (!importText.value.trim()) return
	importLoading.value = true
	try {
		const data = await $fetch('/api/import_zone', {
			method: 'POST',
			body: { apiKey: apiKey.value, currZone: zoneId.value, zoneFile: importText.value }
		})
		if (data?.success) {
			const recs = data?.result?.recs_added ?? data?.result?.total_records_parsed ?? ''
			toast.add({
				id: 'import-zone-success' + Date.now(),
				title: 'Zone imported',
				description: recs ? `${recs} records processed` : 'Records imported successfully',
				icon: 'i-clarity-check-circle-solid',
				duration: 3500,
				color: 'success'
			})
			importModalOpen.value = false
			importText.value = ''
			markRecordsUpdated()
			await getDns({ force: true })
		} else {
			toast.add({
				id: 'import-zone-error' + Date.now(),
				title: 'Import failed',
				description: data?.errors?.[0]?.message || 'Cloudflare rejected the import',
				icon: 'i-clarity-warning-solid',
				duration: 5000,
				color: 'error'
			})
		}
	} catch (error) {
		toast.add({
			id: 'import-zone-error' + Date.now(),
			title: 'Import failed',
			description: error?.data?.statusMessage || error?.message || 'Failed to import zone',
			icon: 'i-clarity-warning-solid',
			duration: 5000,
			color: 'error'
		})
	} finally {
		importLoading.value = false
	}
}

// Format SRV record name for display
const formatSrvRecordName = (record) => {
	const name = record.name

	// Handle Minecraft SRV
	if (name.includes('_minecraft._tcp')) {
		// Extract just what follows after _minecraft._tcp.
		const domainPart = name.split('_minecraft._tcp.')[1]
		if (domainPart) {
			return domainPart
		}
	}

	// Handle general SRV records
	// Remove the service and proto parts, display them in a cleaner way
	const parts = name.split('.')

	// Try to find service and proto parts (with leading underscores)
	const serviceParts = parts.filter((p) => p.startsWith('_'))
	if (serviceParts.length >= 2) {
		// Get domain by removing service parts
		const domainParts = parts.filter((p) => !p.startsWith('_'))

		// Create a cleaner display version
		const service = serviceParts.map((p) => p.replace('_', '')).join('.')
		return `${service}.${domainParts.join('.')}`
	}

	return name
}

const navigateToCreate = () => {
	const destination = { path: `/zones/${zoneId.value}/records/create` }
	if (Object.keys(route.query).length) {
		// Vue Router will encode the query value once more. The create page
		// decodes this inner value to restore filters, including literal `%`.
		destination.query = { return: encodeURIComponent(JSON.stringify(route.query)) }
	}
	router.push(destination)
}

// Add the clearFilters method
const clearFilters = () => {
	searchQuery.value = ''
	selectedStatus.value = []
	page.value = 1

	// Clear URL query params
	router.push({ query: {} })
}

const handleAiApplied = async () => {
	markRecordsUpdated()
	await getDns({ force: true })
}
</script>
