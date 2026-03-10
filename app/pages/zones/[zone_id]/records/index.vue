<template>
	<PageContainer>
		<div class="mb-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
			<div class="flex flex-wrap items-center justify-center gap-3">
				<UButton variant="outline" icon="i-clarity-undo-line" to="/zones">Back to Zones</UButton>
				<UButton variant="outline" color="success" icon="i-clarity-plus-circle-solid" @click="navigateToCreate">
					Create Record
				</UButton>
				<AiDnsEditorModal
					:api-key="apiKey"
					:zone-id="zoneId"
					:zone-name="zoneName"
					@applied="handleAiApplied"
				/>
				<UButton
					v-if="canRulesets"
					variant="outline"
					color="primary"
					icon="i-heroicons-shield-check"
					:to="`/zones/${zoneId}/rules`"
				>
					Rules
				</UButton>
				<UButton
					v-if="canAccountAnalytics"
					variant="outline"
					color="primary"
					icon="i-heroicons-chart-bar"
					:to="`/zones/${zoneId}/analytics`"
				>
					Analytics
				</UButton>
				<UButton
					v-if="canTurnstile"
					variant="outline"
					color="primary"
					icon="i-heroicons-shield-exclamation"
					:to="`/zones/${zoneId}/turnstile`"
				>
					Turnstile
				</UButton>
				<UButton
					v-if="canDnsViews"
					variant="outline"
					color="primary"
					icon="i-heroicons-squares-plus"
					:to="`/zones/${zoneId}/dns-views`"
				>
					DNS Views
				</UButton>
				<UButton
					v-if="canDnsFirewall"
					variant="outline"
					color="primary"
					icon="i-heroicons-shield-check"
					:to="`/zones/${zoneId}/dns-firewall`"
				>
					DNS Firewall
				</UButton>
				<UBadge v-if="searchQuery || selectedStatus.length > 0" color="primary" class="flex items-center gap-2">
					<span v-if="searchQuery">Search: {{ searchQuery }}</span>
					<span v-if="selectedStatus.length > 0">Types: {{ selectedStatus.join(', ') }}</span>
					<UIcon name="i-heroicons-x-mark" class="h-4 w-4 cursor-pointer" @click="clearFilters" />
				</UBadge>
			</div>
		</div>
		<div class="flex flex-col items-center justify-center gap-4">
			<div class="flex w-full flex-col justify-center gap-4">
				<div class="flex flex-col items-center justify-center gap-3 sm:flex-row">
					<NuxtLink
						:to="'http://' + zoneName"
						external
						target="_blank"
						class="text-comet-900 dark:text-comet-100 text-center text-2xl font-semibold hover:underline"
					>
						{{ zoneName }}
					</NuxtLink>
					<CapabilityIndicator :missing-items="capabilityMissing" />
					<UTooltip
						:text="
							botUnavailable
								? botUnavailableReason || 'Bot Fight Mode is unavailable for this zone/token'
								: 'Toggle Bot Fight Mode'
						"
					>
						<div
							v-if="canBotFight"
							class="border-comet-300 dark:border-comet-700 dark:bg-comet-900/40 flex items-center gap-3 rounded-full border bg-white/70 px-3 py-1.5 shadow-xs backdrop-blur-sm"
						>
							<div class="flex items-center gap-2">
								<UIcon name="i-heroicons-bug-ant" class="text-comet-700 dark:text-comet-200 h-5 w-5" />
								<span class="text-comet-800 dark:text-comet-100 text-sm font-medium"
									>Bot Fight Mode</span
								>
							</div>
							<div class="flex items-center gap-2">
								<UBadge v-if="botUnavailable" color="neutral" variant="subtle"> Unavailable </UBadge>
								<UBadge v-else :color="botFightMode ? 'success' : 'warning'" variant="subtle">
									{{ botFightMode ? 'On' : 'Off' }}
								</UBadge>
								<UIcon
									v-if="botLoading"
									name="i-heroicons-arrow-path"
									class="text-comet-500 h-4 w-4 animate-spin"
								/>
								<USwitch
									:model-value="botFightMode"
									:disabled="botLoading || botUnavailable"
									@update:model-value="updateBotFightMode"
								/>
							</div>
						</div>
					</UTooltip>
					<div v-if="canSsl" class="relative">
						<UDropdownMenu :items="sslMenuItems" :content="{ align: 'end' }">
							<UButton variant="ghost" color="neutral" size="sm" class="p-1">
								<UIcon
									v-if="zone.ssl?.value === 'strict'"
									name="i-clarity-lock-solid"
									class="h-6 w-6"
								/>
								<UIcon v-if="zone.ssl?.value === 'full'" name="i-clarity-lock-line" class="h-6 w-6" />
								<UIcon
									v-if="zone.ssl?.value === 'flexible'"
									name="i-clarity-curve-chart-solid"
									class="h-6 w-6"
								/>
								<UIcon
									v-if="zone.ssl?.value === 'off'"
									name="i-clarity-no-access-solid"
									class="h-6 w-6"
								/>
							</UButton>
						</UDropdownMenu>
					</div>
				</div>
				<div class="grid w-full grid-cols-2 gap-3 md:grid-cols-4">
					<div
						class="border-comet-200 dark:border-comet-700 dark:bg-comet-900/40 rounded-lg border bg-white/70 p-3"
					>
						<div class="text-comet-500 text-xs">Records</div>
						<div class="text-comet-900 dark:text-comet-100 text-lg font-semibold">{{ totalRecords }}</div>
					</div>
					<div
						class="border-comet-200 dark:border-comet-700 dark:bg-comet-900/40 rounded-lg border bg-white/70 p-3"
					>
						<div class="text-comet-500 text-xs">Filtered</div>
						<div class="text-comet-900 dark:text-comet-100 text-lg font-semibold">{{ filteredCount }}</div>
					</div>
					<div
						class="border-comet-200 dark:border-comet-700 dark:bg-comet-900/40 rounded-lg border bg-white/70 p-3"
					>
						<div class="text-comet-500 text-xs">Proxied</div>
						<div class="text-comet-900 dark:text-comet-100 text-lg font-semibold">{{ proxiedCount }}</div>
					</div>
					<div
						class="border-comet-200 dark:border-comet-700 dark:bg-comet-900/40 rounded-lg border bg-white/70 p-3"
					>
						<div class="text-comet-500 text-xs">Types</div>
						<div class="text-comet-900 dark:text-comet-100 text-lg font-semibold">{{ typesCount }}</div>
					</div>
				</div>
				<div class="flex translate-x-[12px] flex-wrap items-center justify-center gap-4">
					<div
						v-for="ns in zone.name_servers || []"
						:key="ns"
						class="group flex cursor-pointer items-center gap-4"
						@click="copyToClipboard(ns)"
					>
						<p class="text-comet-600 dark:text-comet-400 font-bold italic">{{ ns }}</p>
						<UIcon name="i-clarity-clipboard-line" class="opacity-0 group-hover:opacity-100" />
					</div>
				</div>
			</div>
			<div class="flex w-full flex-col items-center justify-center gap-4">
				<div
					v-if="dnsLoadError"
					class="w-full rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
				>
					{{ dnsLoadError }}
				</div>
				<div class="flex w-full flex-wrap items-center justify-between gap-4">
					<div class="flex w-full gap-4 md:w-[calc(50%-0.5rem)]">
						<USelectMenu
							v-model="selectedStatus"
							:items="dnsTypes"
							multiple
							placeholder="Type"
							class="min-w-24"
						/>
						<div class="relative grow">
							<UTooltip text="Press '/' to search">
								<UInput
									ref="searchInput"
									v-model="searchQuery"
									icon="i-heroicons-magnifying-glass-20-solid"
									type="text"
									placeholder="Search records..."
									color="neutral"
									class="w-full min-w-48 transition-all focus-within:shadow-md"
									size="lg"
									@focus="
										() => {
											setTimeout(
												() => searchInput.value?.$el.querySelector('input')?.select(),
												100
											)
										}
									"
								/>
							</UTooltip>
							<span
								v-if="searchQuery"
								class="text-comet-500 hover:text-comet-700 absolute top-2 right-2 cursor-pointer"
								@click="searchQuery = ''"
							>
								<UIcon name="i-heroicons-x-mark-20-solid" class="h-5 w-5" />
							</span>
						</div>
					</div>
					<div class="flex w-full items-center gap-4 md:w-[calc(50%-0.5rem)] md:justify-end">
						<USelect v-model="pageSize" :items="pageSizeOptions" size="md" class="w-28" />
						<UButton
							v-if="selectedRecordIds.length"
							color="error"
							variant="outline"
							icon="i-heroicons-trash-20-solid"
							class="grow md:grow-0"
							@click="openDeleteModal(selectedRecords)"
						>
							Delete ({{ selectedRecordIds.length }})
						</UButton>
						<UDropdownMenu :items="columnPickerItems" :content="{ align: 'end' }">
							<UButton
								label="Columns"
								color="neutral"
								variant="outline"
								trailing-icon="i-heroicons-chevron-down-20-solid"
								class="grow md:grow-0"
							/>
						</UDropdownMenu>
						<UPagination
							v-model:page="page"
							:items-per-page="pageSize"
							:total="filteredRecords.length"
							class="shrink-0 md:ml-2"
						/>
					</div>
				</div>
				<UTable
					v-model:column-visibility="columnVisibility"
					:data="rows"
					:columns="columns"
					:loading="loading"
					class="border-comet-300 dark:border-comet-700 w-full rounded-lg border"
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
							@click.stop
							@update:model-value="(value) => toggleSelectAllVisible(value === true)"
						/>
					</template>
					<template #select-cell="{ row }">
						<UCheckbox
							:model-value="selectedRecordIds.includes(row.original.id)"
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
							<p
								class="min-w-0 truncate text-xs font-medium group-hover:underline md:text-sm"
								@click="navigateToRecord(row.original.id)"
							>
								{{ row.original._displayName }}
							</p>
							<UTooltip text="Open in new tab">
								<UButton
									icon="i-heroicons-arrow-top-right-on-square"
									variant="ghost"
									color="neutral"
									size="xs"
									@click.stop="openRecordUrl(row.original)"
								/>
							</UTooltip>
						</div>
					</template>
					<template #content-cell="{ row }">
						<div
							class="group flex max-w-[120px] items-center gap-4 overflow-hidden sm:max-w-[200px] md:max-w-[280px] lg:max-w-[360px]"
						>
							<p
								class="truncate text-xs font-medium group-hover:underline md:text-sm"
								@click="navigateToRecord(row.original.id)"
							>
								{{ row.original._displayContent }}
							</p>
							<div v-if="row.original.proxiable" @click.stop>
								<USwitch
									v-model="row.original.proxied"
									color="warning"
									@update:model-value="() => updateProxyStatus(row.original)"
								/>
							</div>
						</div>
					</template>
					<template #created_on-cell="{ row }">
						<div
							v-if="isLargeScreen"
							class="flex max-w-[200px] items-center gap-4 truncate overflow-hidden text-xs md:text-sm"
						>
							<p class="truncate">{{ dayjs(row.original.created_on).format('DD/MM/YYYY') }}</p>
						</div>
					</template>
					<template #modified_on-cell="{ row }">
						<div
							v-if="isLargeScreen"
							class="flex max-w-[200px] items-center gap-4 truncate overflow-hidden text-xs md:text-sm"
						>
							<p class="truncate">{{ dayjs(row.original.modified_on).format('DD/MM/YYYY') }}</p>
						</div>
					</template>
					<template #actions-cell="{ row }">
						<UDropdownMenu :items="items(row.original)">
							<UButton
								color="neutral"
								variant="ghost"
								icon="i-heroicons-ellipsis-horizontal-20-solid"
								@click.stop
							/>
						</UDropdownMenu>
					</template>
				</UTable>
				<div class="flex w-full justify-end">
					<UPagination v-model:page="page" :items-per-page="pageSize" :total="filteredRecords.length" />
				</div>
				<UModal v-model:open="deleteModalOpen">
					<template #title>
						<div class="flex items-center gap-2">
							<UIcon name="i-heroicons-exclamation-triangle" class="h-5 w-5 text-red-500" />
							<span>Delete records</span>
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
						<div class="flex justify-end gap-3">
							<UButton color="neutral" variant="ghost" @click="closeDeleteModal">Cancel</UButton>
							<UButton color="error" :loading="deleteLoading" @click="confirmDelete">Delete</UButton>
						</div>
					</template>
				</UModal>
			</div>
		</div>
	</PageContainer>
</template>

<script setup>
import dayjs from 'dayjs'
import { useDebounceFn } from '@vueuse/core'

const route = useRoute()
const router = useRouter()
const toast = useToast()
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
const windowSize = useWindowSize()
const isLargeScreen = computed(() => windowSize.width.value >= 768)
const botFightMode = ref(false)
const botLoading = ref(false)
const botUnavailable = ref(false)
const botUnavailableReason = ref('')
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
	const response = await fetch('/api/update_record', {
		method: 'POST',
		body: JSON.stringify({
			apiKey: apiKey.value,
			currZone: zoneId.value,
			currDnsRecord: record.id,
			dns: { ...record, proxied: record.proxied ? true : false }
		})
	})
	if (response.ok) {
		const data = await response.json()
		if (data.success) {
			toast.add({
				id: 'update-proxy-success' + Date.now(),
				title: 'Update success',
				description: 'Proxy status updated successfully',
				icon: 'i-clarity-check-circle-solid',
				duration: 3000,
				color: 'success'
			})
			markRecordsUpdated()
			await getDns({ force: true })
		} else {
			console.error(data.errors[0].message)
			toast.add({
				id: 'update-proxy-error' + Date.now(),
				title: 'Update failed',
				description: data.errors[0].message,
				icon: 'i-clarity-warning-solid',
				duration: 3000,
				color: 'error'
			})
		}
	} else {
		console.error('HTTP-Error: ' + response.status)
	}
}

const updateSslSetting = async (sslMode) => {
	const response = await fetch('/api/update_ssl', {
		method: 'POST',
		body: JSON.stringify({
			apiKey: apiKey.value,
			currZone: zoneId.value,
			ssl: sslMode
		})
	})
	if (response.ok) {
		const data = await response.json()
		if (data.success) {
			toast.add({
				id: 'update-ssl-success' + Date.now(),
				title: 'Update success',
				description: 'SSL status updated successfully',
				icon: 'i-clarity-check-circle-solid',
				duration: 3000,
				color: 'success'
			})
			await getAll()
		} else {
			console.error(data.errors[0].message)
			toast.add({
				id: 'update-ssl-error' + Date.now(),
				title: 'Update failed',
				description: data.errors[0].message,
				icon: 'i-clarity-warning-solid',
				duration: 3000,
				color: 'error'
			})
		}
	} else {
		console.error('HTTP-Error: ' + response.status)
	}
}

const sslMenuItems = computed(() => [
	{
		label: 'Strict',
		icon: 'i-clarity-lock-solid',
		onSelect: () => updateSslSetting('strict')
	},
	{
		label: 'Full',
		icon: 'i-clarity-lock-line',
		onSelect: () => updateSslSetting('full')
	},
	{
		label: 'Flexible',
		icon: 'i-clarity-curve-chart-solid',
		onSelect: () => updateSslSetting('flexible')
	},
	{
		label: 'Off',
		icon: 'i-clarity-no-access-solid',
		onSelect: () => updateSslSetting('off')
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

const items = (row) => {
	return [
		[
			{
				label: 'Edit',
				icon: 'i-heroicons-pencil-square-20-solid',
				onClick: () => navigateToRecord(row.id)
			},
			{
				label: 'Open',
				icon: 'i-heroicons-arrow-top-right-on-square',
				onClick: () => openRecordUrl(row)
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
				onClick: () => openDeleteModal(row)
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

	if (name === zoneName.value || !name.endsWith(zoneName.value)) {
		return name
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

const totalRecords = computed(() => (dnsRecords.value || []).length)
const filteredCount = computed(() => (filteredRecords.value || []).length)
const proxiedCount = computed(() => (dnsRecords.value || []).filter((r) => r && r.proxied === true).length)
const typesCount = computed(() => (dnsTypes.value || []).length)
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
	apiKey.value = (localStorage.getItem('cf-api-key') || '').trim()
	if (!apiKey.value) {
		router.push('/login')
		return
	}

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

// Keyboard shortcut handler
const handleKeyDown = (e) => {
	// Focus search box when '/' is pressed and not in an input field
	if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
		e.preventDefault()
		searchInput.value?.$el.querySelector('input')?.focus()
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
	const results = await Promise.all(deleteTargets.value.map((record) => delDns(record)))
	const successCount = results.filter(Boolean).length
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
	deleteLoading.value = false
	closeDeleteModal()
}

const navigateToRecord = (recordId) => {
	// Also store in localStorage for compatibility with older pages
	localStorage.setItem('cf-dns-id', recordId)

	// Find record to store its name
	const record = dnsRecords.value.find((r) => r.id === recordId)
	if (record) {
		localStorage.setItem('cf-dns-name', record.name)
	}

	// Add return query parameters to preserve filter state
	let returnQuery = ''
	if (Object.keys(route.query).length > 0) {
		// Encode the current query state
		returnQuery = encodeURIComponent(JSON.stringify(route.query))
	}

	// Navigate with return query param if we have filters
	if (returnQuery) {
		router.push(`/zones/${zoneId.value}/records/${recordId}?return=${returnQuery}`)
	} else {
		router.push(`/zones/${zoneId.value}/records/${recordId}`)
	}
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

const copyToClipboard = (text) => {
	navigator.clipboard.writeText(text)
	toast.add({
		id: 'copy-ns' + Date.now(),
		title: 'Copied to clipboard',
		description: 'Nameserver copied to clipboard',
		icon: 'i-clarity-check-circle-solid',
		duration: 3000,
		color: 'success'
	})
}

// Utility function to format content based on record type
const formatContent = (record) => {
	if (record.type === 'SRV' && record.data) {
		// For Minecraft SRV records, use a special format
		if (record.name && record.name.includes('_minecraft._tcp')) {
			// Extract just what follows after _minecraft._tcp.
			const domainPart = record.name.split('_minecraft._tcp.')[1]
			if (domainPart) {
				return `${domainPart} → ${record.data.target}:${record.data.port}`
			}
		}

		// Make sure we have all the required fields before showing them
		if (record.data.target && record.data.port) {
			return `➡️ ${record.data.target}:${record.data.port}${record.data.weight ? ` (Weight: ${record.data.weight})` : ''}`
		}
	}

	// For all other record types or if SRV is missing data
	return record.content || ''
}

// Get color for record type badge
const getRecordTypeColor = (type) => {
	const colorMap = {
		A: 'primary',
		AAAA: 'secondary',
		CNAME: 'success',
		MX: 'info',
		SRV: 'warning',
		TXT: 'neutral'
	}
	return colorMap[type] || 'neutral'
}

// Get icon for record types
const getRecordTypeIcon = (type) => {
	const iconMap = {
		A: 'mdi:alpha-a-circle',
		AAAA: 'mdi:alpha-a-circle',
		CNAME: 'mdi:alpha-c-circle',
		MX: 'mdi:email',
		SRV: 'mdi:server',
		TXT: 'mdi:text-box'
	}
	return iconMap[type] || 'mdi:dns'
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

// Add function to navigate to create page with return state
const navigateToCreate = () => {
	// Add return query parameters to preserve filter state
	let returnQuery = ''
	if (Object.keys(route.query).length > 0) {
		// Encode the current query state
		returnQuery = encodeURIComponent(JSON.stringify(route.query))
	}

	// Navigate with return query param if we have filters
	if (returnQuery) {
		router.push(`/zones/${zoneId.value}/records/create?return=${returnQuery}`)
	} else {
		router.push(`/zones/${zoneId.value}/records/create`)
	}
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
