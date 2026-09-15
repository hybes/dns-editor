<template>
	<UDashboardPanel id="zone-records">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span v-if="zoneName" class="truncate">{{ zoneName }}</span>
					<span v-else-if="zoneLoading" class="bg-elevated block h-5 w-40 animate-pulse rounded-md">
						<span class="sr-only">Loading zone</span>
					</span>
					<span v-else>DNS records</span>
				</template>

				<template #right>
					<UButton
						icon="i-lucide-plus"
						label="Add record"
						aria-label="Add record"
						:to="createLink"
						:ui="{ label: 'hidden sm:inline' }"
					/>
					<UButton
						v-if="aiAvailable"
						icon="i-lucide-clipboard-paste"
						label="AI editor"
						aria-label="AI editor"
						color="neutral"
						variant="outline"
						:ui="{ label: 'hidden sm:inline' }"
						@click="aiOpen = true"
					/>
					<UTooltip text="Refresh records">
						<UButton
							icon="i-lucide-refresh-cw"
							color="neutral"
							variant="ghost"
							aria-label="Refresh records"
							:loading="loading"
							@click="refreshRecords"
						/>
					</UTooltip>
					<UDropdownMenu :items="moreItems" :content="{ align: 'end' }">
						<UButton
							icon="i-lucide-ellipsis"
							color="neutral"
							variant="ghost"
							aria-label="More record actions"
						/>
					</UDropdownMenu>
				</template>
			</UDashboardNavbar>

			<UDashboardToolbar
				:ui="{
					root: 'flex-wrap gap-2 py-2 overflow-visible',
					left: 'w-full flex-wrap gap-2 sm:w-auto',
					right: 'flex-wrap gap-2'
				}"
			>
				<template #left>
					<UFormField
						label="Search records"
						name="record-search"
						class="w-full sm:w-72"
						:ui="{ labelWrapper: 'sr-only' }"
					>
						<UInput
							ref="searchField"
							v-model="searchInput"
							type="search"
							icon="i-lucide-search"
							placeholder="Search names, values, comments"
							autocomplete="off"
							:spellcheck="false"
							class="w-full"
							@update:model-value="commitSearch"
						>
							<template #trailing>
								<UKbd value="/" class="hidden sm:inline-flex" />
							</template>
						</UInput>
					</UFormField>
					<UFormField
						label="Record types"
						name="record-types"
						class="w-full sm:w-48"
						:ui="{ labelWrapper: 'sr-only' }"
					>
						<USelectMenu
							:model-value="selectedTypes"
							:items="typeItems"
							value-key="value"
							multiple
							placeholder="All types"
							:search-input="false"
							class="w-full"
							@update:model-value="setTypes"
						/>
					</UFormField>
				</template>

				<template #right>
					<template v-if="selectedRows.length">
						<p class="text-highlighted text-sm tabular-nums">{{ selectionLabel }}</p>
						<UButton
							v-if="canSelectAllMatching"
							color="neutral"
							variant="link"
							:label="selectAllLabel"
							@click="selectAllMatching"
						/>
						<UButton
							ref="clearSelectionButton"
							color="neutral"
							variant="ghost"
							label="Clear selection"
							@click="clearSelectionFromToolbar"
						/>
						<UButton
							color="error"
							variant="soft"
							icon="i-lucide-trash-2"
							:label="`Delete ${formatNumber(selectedRows.length)}`"
							:disabled="partial"
							@click="openDelete(selectedRows)"
						/>
					</template>
					<template v-else>
						<p v-if="loaded" class="text-muted text-sm tabular-nums" aria-live="polite">{{ countLabel }}</p>
						<UDropdownMenu :items="columnItems" :content="{ align: 'end' }">
							<UButton
								icon="i-lucide-columns-3"
								label="Columns"
								color="neutral"
								variant="outline"
								class="hidden sm:inline-flex"
							/>
						</UDropdownMenu>
					</template>
				</template>
			</UDashboardToolbar>
		</template>

		<template #body>
			<UAlert
				v-if="recordsError"
				color="error"
				variant="subtle"
				icon="i-lucide-circle-alert"
				:title="loaded ? 'Couldn’t refresh DNS records' : 'Couldn’t load DNS records'"
				:description="loaded ? `${sentence(recordsError)} The list below may be out of date.` : recordsError"
				:actions="[
					{
						label: 'Try again',
						icon: 'i-lucide-refresh-cw',
						color: 'neutral',
						variant: 'outline',
						loading,
						onClick: refreshRecords
					}
				]"
			/>

			<UAlert
				v-if="partial"
				color="warning"
				variant="subtle"
				icon="i-lucide-triangle-alert"
				title="Some records didn’t load"
				:description="`${sentence(partialMessage)} Bulk delete is off until the full list loads.`"
				:actions="[
					{
						label: 'Try again',
						icon: 'i-lucide-refresh-cw',
						color: 'neutral',
						variant: 'outline',
						loading,
						onClick: refreshRecords
					}
				]"
			/>

			<UAlert
				v-if="zoneError && !zoneName"
				color="neutral"
				variant="subtle"
				icon="i-lucide-info"
				title="Couldn’t load zone details"
				:description="`${sentence(zoneError)} Names are shown in full until it loads.`"
				:actions="[
					{
						label: 'Try again',
						icon: 'i-lucide-refresh-cw',
						color: 'neutral',
						variant: 'outline',
						loading: zoneLoading,
						onClick: () => zoneApi.refresh()
					}
				]"
			/>

			<div v-if="loaded || !recordsError" class="flex min-h-80 flex-1 flex-col gap-3">
				<UTable
					v-model:row-selection="rowSelection"
					:data="pageRows"
					:columns="columns"
					:column-visibility="columnVisibility"
					:get-row-id="getRowId"
					:loading="loading || !loaded"
					:meta="TABLE_META"
					sticky="header"
					caption="DNS records"
					class="min-h-0 flex-1"
					:ui="{ th: 'py-2', td: 'py-2.5' }"
				>
					<template v-for="column in SORTABLE_COLUMNS" :key="column.id" #[column.slot]>
						<UButton
							color="neutral"
							variant="ghost"
							size="sm"
							class="text-highlighted -mx-2.5 font-semibold"
							:label="column.label"
							:trailing-icon="sortIcon(column.id)"
							:aria-label="sortAriaLabel(column)"
							@click="toggleSort(column.id)"
						/>
					</template>

					<template #select-header="{ table }">
						<UCheckbox
							:model-value="
								table.getIsSomePageRowsSelected() ? 'indeterminate' : table.getIsAllPageRowsSelected()
							"
							:disabled="!pageRows.length"
							aria-label="Select all records on this page"
							@update:model-value="(value) => table.toggleAllPageRowsSelected(!!value)"
						/>
					</template>

					<template #select-cell="{ row }">
						<UCheckbox
							:model-value="row.getIsSelected()"
							:aria-label="`Select ${row.original.label}`"
							@update:model-value="(value) => row.toggleSelected(!!value)"
						/>
					</template>

					<template #summary-cell="{ row }">
						<div class="flex min-w-0 flex-col gap-1">
							<div class="flex min-w-0 items-center gap-2">
								<NuxtLink
									:to="editLink(row.original.id)"
									:title="row.original.record.name"
									class="text-highlighted focus-visible:outline-primary min-w-0 truncate rounded-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
								>
									<span class="sr-only">Edit {{ row.original.type }} record </span>
									{{ row.original.displayName }}
								</NuxtLink>
								<UBadge
									:color="getRecordTypeColor(row.original.type)"
									variant="subtle"
									size="sm"
									class="shrink-0 font-mono"
								>
									{{ row.original.type }}
								</UBadge>
								<UBadge
									v-if="row.original.record.proxiable && proxiedState(row.original.record)"
									color="primary"
									variant="outline"
									size="sm"
									class="shrink-0"
								>
									Proxied
								</UBadge>
							</div>
							<p class="text-muted line-clamp-2 font-mono text-xs break-all">
								<span v-if="row.original.priority !== null" class="text-dimmed"
									>{{ row.original.priority }}&nbsp;</span
								>{{ row.original.value }}
							</p>
						</div>
					</template>

					<template #type-cell="{ row }">
						<UBadge :color="getRecordTypeColor(row.original.type)" variant="subtle" class="font-mono">
							{{ row.original.type }}
						</UBadge>
					</template>

					<template #name-cell="{ row }">
						<div class="flex max-w-56 min-w-0 flex-col xl:max-w-80">
							<NuxtLink
								:to="editLink(row.original.id)"
								:title="row.original.record.name"
								class="text-highlighted focus-visible:outline-primary truncate rounded-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
							>
								<span class="sr-only">Edit {{ row.original.type }} record </span>
								{{ row.original.displayName }}
							</NuxtLink>
							<span
								v-if="row.original.record.comment"
								class="text-dimmed truncate text-xs"
								:title="row.original.record.comment"
							>
								{{ row.original.record.comment }}
							</span>
						</div>
					</template>

					<template #value-cell="{ row }">
						<div class="flex min-w-0 items-center gap-1.5">
							<span
								v-if="row.original.priority !== null"
								class="text-dimmed shrink-0 font-mono tabular-nums"
							>
								<span class="sr-only">Priority </span>{{ row.original.priority }}
							</span>
							<span class="text-default min-w-0 truncate font-mono" :title="row.original.value">
								{{ row.original.value }}
							</span>
							<UButton
								v-if="row.original.value"
								icon="i-lucide-copy"
								color="neutral"
								variant="ghost"
								size="xs"
								class="shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
								:aria-label="`Copy value of ${row.original.label}`"
								@click="copyValue(row.original)"
							/>
						</div>
					</template>

					<template #ttl-cell="{ row }">
						<span class="tabular-nums">{{ formatTtl(row.original.record.ttl) }}</span>
					</template>

					<template #proxied-cell="{ row }">
						<USwitch
							v-if="row.original.record.proxiable"
							:model-value="proxiedState(row.original.record)"
							:loading="row.original.id in pendingProxy"
							:disabled="row.original.id in pendingProxy"
							:aria-label="`Proxy ${row.original.label} through Cloudflare`"
							@update:model-value="(value) => setProxied(row.original, value)"
						/>
						<span v-else class="text-dimmed">
							<span aria-hidden="true">–</span>
							<span class="sr-only">Can’t be proxied</span>
						</span>
					</template>

					<template #modified-cell="{ row }">
						<time
							v-if="row.original.modified"
							:datetime="row.original.record.modified_on"
							:title="formatDate(row.original.modified, 'datetime')"
							class="tabular-nums"
						>
							{{ formatRelative(row.original.modified) }}
						</time>
					</template>

					<template #actions-header>
						<span class="sr-only">Actions</span>
					</template>

					<template #actions-cell="{ row }">
						<div class="flex justify-end">
							<UDropdownMenu :items="rowActions(row.original)" :content="{ align: 'end' }">
								<UButton
									icon="i-lucide-ellipsis-vertical"
									color="neutral"
									variant="ghost"
									:aria-label="`Actions for ${row.original.label}`"
								/>
							</UDropdownMenu>
						</div>
					</template>

					<template #loading>
						<div v-if="!loaded" role="status" class="flex flex-col gap-3 text-start">
							<span class="sr-only">Loading DNS records</span>
							<div v-for="line in 6" :key="line" class="flex items-center gap-4">
								<USkeleton class="h-5 w-12" />
								<USkeleton class="h-4 w-32" />
								<USkeleton class="h-4 flex-1" />
							</div>
						</div>
						<UEmpty v-else v-bind="emptyState" variant="naked" />
					</template>

					<template #empty>
						<UEmpty v-bind="emptyState" variant="naked" />
					</template>
				</UTable>

				<div v-if="loaded && sortedRows.length" class="flex flex-wrap items-center justify-between gap-3">
					<p class="text-muted text-sm tabular-nums">{{ rangeLabel }}</p>
					<div class="flex flex-wrap items-center gap-3">
						<UFormField
							label="Rows per page"
							name="records-page-size"
							orientation="horizontal"
							:ui="{ root: 'items-center gap-2', label: 'text-muted font-normal' }"
						>
							<USelect
								:model-value="pageSize"
								:items="PAGE_SIZE_ITEMS"
								class="w-20"
								@update:model-value="setPageSize"
							/>
						</UFormField>
						<UPagination
							v-if="pageCount > 1"
							:page="page"
							:total="sortedRows.length"
							:items-per-page="pageSize"
							:sibling-count="isMobile ? 0 : 1"
							show-edges
							@update:page="setPage"
						/>
					</div>
				</div>
			</div>

			<UModal
				v-model:open="deleteOpen"
				:title="deleteTitle"
				:description="deleteDescription"
				:dismissible="!deleting"
				:close="!deleting"
			>
				<template #body>
					<div class="flex flex-col gap-3">
						<UAlert
							v-if="deleteSummary"
							role="alert"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							:title="deleteSummary.title"
							:description="deleteSummary.description"
						/>
						<ul class="divide-default max-h-80 divide-y overflow-y-auto">
							<li
								v-for="target in deleteTargets"
								:key="target.id"
								class="flex min-w-0 flex-col gap-0.5 py-2"
							>
								<div class="flex min-w-0 items-center gap-2">
									<UBadge
										:color="getRecordTypeColor(target.type)"
										variant="subtle"
										size="sm"
										class="shrink-0 font-mono"
									>
										{{ target.type }}
									</UBadge>
									<span
										class="text-highlighted min-w-0 truncate text-sm font-medium"
										:title="target.record.name"
									>
										{{ target.displayName }}
									</span>
								</div>
								<p class="text-muted truncate font-mono text-xs" :title="target.value">
									{{ target.value }}
								</p>
								<p v-if="deleteFailures[target.id]" class="text-error text-xs">
									{{ deleteFailures[target.id] }}
								</p>
							</li>
						</ul>
					</div>
				</template>
				<template #footer>
					<div class="flex w-full justify-end gap-2">
						<UButton
							color="neutral"
							variant="ghost"
							:label="deleteSummary ? 'Close' : 'Cancel'"
							:disabled="deleting"
							@click="deleteOpen = false"
						/>
						<UButton
							color="error"
							icon="i-lucide-trash-2"
							:label="deleteButtonLabel"
							:loading="deleting"
							@click="confirmDelete"
						/>
					</div>
				</template>
			</UModal>

			<UModal
				v-model:open="importOpen"
				title="Import zone file"
				:description="`Add records to ${zoneName || 'this zone'} from a BIND zone file, such as one exported from another DNS provider.`"
				:dismissible="!importing"
				:close="!importing"
				:ui="{ content: 'sm:max-w-xl' }"
			>
				<template #body>
					<div class="flex flex-col gap-4">
						<UFormField label="Zone file" name="zone-file-upload">
							<UFileUpload
								v-model="importFile"
								accept=".zone,.txt,.db,.bind,text/plain"
								label="Drop a zone file here"
								description="or choose one from your device"
								layout="list"
								icon="i-lucide-file-up"
								class="min-h-28 w-full"
							/>
						</UFormField>
						<UFormField
							label="Zone file contents"
							name="zone-file-contents"
							description="Loaded from the file above, or paste the contents here."
						>
							<UTextarea
								v-model="importText"
								:rows="8"
								placeholder="www 3600 IN A 192.0.2.1"
								class="w-full"
								:ui="{ base: 'font-mono text-xs' }"
							/>
						</UFormField>
						<UCheckbox
							v-model="importProxied"
							name="zone-file-proxied"
							label="Proxy imported records"
							description="Cloudflare proxies the A, AAAA and CNAME records it can. Leave this off to import them as DNS only."
						/>
						<UAlert
							v-if="importNotice"
							role="alert"
							:color="importNotice.color"
							variant="subtle"
							:icon="importNotice.color === 'error' ? 'i-lucide-circle-alert' : 'i-lucide-triangle-alert'"
							:title="importNotice.title"
							:description="importNotice.description"
						/>
					</div>
				</template>
				<template #footer>
					<div class="flex w-full justify-end gap-2">
						<UButton
							color="neutral"
							variant="ghost"
							label="Cancel"
							:disabled="importing"
							@click="importOpen = false"
						/>
						<UButton
							icon="i-lucide-upload"
							label="Import records"
							:loading="importing"
							:disabled="!importText.trim()"
							@click="importZone"
						/>
					</div>
				</template>
			</UModal>

			<AiDnsEditorModal v-if="aiAvailable" v-model:open="aiOpen" :zone-id="zoneId" :zone-name="zoneName" />

			<!-- The record create/edit panel opens over the table, which stays mounted. -->
			<NuxtPage />
		</template>
	</UDashboardPanel>
</template>

<script setup>
import { breakpointsTailwind, useBreakpoints, useDebounceFn, useLocalStorage, useNow } from '@vueuse/core'
import { PROPAGATION_TYPES } from '#shared/utils/dnsTypes'

const SORTABLE_COLUMNS = [
	{ id: 'type', label: 'Type', slot: 'type-header' },
	{ id: 'name', label: 'Name', slot: 'name-header' },
	{ id: 'modified', label: 'Modified', slot: 'modified-header' }
]
const DEFAULT_SORT = { id: 'type', desc: false }
const PAGE_SIZES = [25, 50, 100, 250]
const DEFAULT_PAGE_SIZE = 50
const PAGE_SIZE_ITEMS = PAGE_SIZES.map((size) => ({ label: String(size), value: size }))
const HIDEABLE_COLUMNS = [
	{ id: 'type', label: 'Type' },
	{ id: 'value', label: 'Value' },
	{ id: 'ttl', label: 'TTL' },
	{ id: 'proxied', label: 'Proxy' },
	{ id: 'modified', label: 'Modified' }
]
// The propagation checker queries these types, and a wildcard name can't be queried.
const PROPAGATION_TYPE_SET = new Set(PROPAGATION_TYPES)
const WEB_TYPES = new Set(['A', 'AAAA', 'CNAME'])
const DELETE_CONCURRENCY = 4
const RELATIVE_UNITS = [
	['year', 31_536_000],
	['month', 2_592_000],
	['week', 604_800],
	['day', 86_400],
	['hour', 3_600],
	['minute', 60]
]
const TABLE_META = { class: { tr: 'group/row' } }

const columns = [
	{ id: 'select', header: '', meta: { class: { th: 'w-10', td: 'w-10' } } },
	{ id: 'summary', header: 'Record', meta: { class: { td: 'w-full max-w-0 whitespace-normal' } } },
	{ id: 'type', header: 'Type' },
	{ id: 'name', header: 'Name' },
	{ id: 'value', header: 'Value', meta: { class: { td: 'w-full max-w-0 min-w-48' } } },
	{ id: 'ttl', header: 'TTL' },
	{ id: 'proxied', header: 'Proxy' },
	{ id: 'modified', header: 'Modified' },
	{ id: 'actions', header: '', meta: { class: { th: 'w-12', td: 'w-12' } } }
]

const route = useRoute()
const router = useRouter()
const notify = useNotify()
const { call } = useCfApi()
const { getRecordTypeColor, formatContent, formatTtl, getExpectedDnsValue } = useRecordTypes()

const zoneId = computed(() => String(route.params.zone_id || ''))
const zoneApi = useZone(zoneId)
const { zoneName, loading: zoneLoading, error: zoneError } = zoneApi
const recordsApi = useZoneRecords(zoneId)
const { records, loading, loaded, partial, error: recordsError } = recordsApi

const partialMessage = computed(
	() =>
		recordsApi.partialMessage?.value ||
		'Cloudflare didn’t return every page of records, so this list is incomplete.'
)

useSeoMeta({ title: computed(() => (zoneName.value ? `DNS records · ${zoneName.value}` : 'DNS records')) })

watch(
	zoneId,
	(id) => {
		if (!id) return
		zoneApi.load()
		recordsApi.load()
	},
	{ immediate: true }
)

const refreshRecords = () => {
	recordsApi.refresh()
	if (zoneError.value) zoneApi.refresh()
}

const typeList = new Intl.ListFormat(LOCALE, { type: 'disjunction' })
const sentence = (text) => {
	const value = String(text || '').trim()
	return !value || /[.!?]$/.test(value) ? value : `${value}.`
}

// URL state: search, types, sort, page and page size all live in route.query.

const queryValue = (value) => {
	if (typeof value === 'string') return value
	return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

const search = computed(() => queryValue(route.query.search).trim())
const selectedTypes = computed(() => [
	...new Set(
		queryValue(route.query.types)
			.split(',')
			.map((type) => type.trim().toUpperCase())
			.filter(Boolean)
	)
])
const sort = computed(() => {
	const raw = queryValue(route.query.sort)
	const desc = raw.startsWith('-')
	const id = desc ? raw.slice(1) : raw
	return SORTABLE_COLUMNS.some((column) => column.id === id) ? { id, desc } : DEFAULT_SORT
})
const pageSize = computed(() => {
	const size = Number(queryValue(route.query.size))
	return PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE
})
const requestedPage = computed(() => {
	const value = Number.parseInt(queryValue(route.query.page), 10)
	return Number.isFinite(value) && value > 0 ? value : 1
})
const hasFilters = computed(() => Boolean(search.value || selectedTypes.value.length))

// The one place the list's URL state is written. replace() keeps filter tweaks out of the
// history, and everything reads route.query, so Back, Forward and closing the record panel
// all restore the same view.
const updateQuery = (changes) => {
	const current = route.query
	const kept = Object.entries(current).filter(([key]) => !(key in changes))
	const set = Object.entries(changes)
		.filter(([, value]) => value !== undefined && value !== null && value !== '')
		.map(([key, value]) => [key, String(value)])
	const query = Object.fromEntries([...kept, ...set])
	const unchanged =
		Object.keys(query).length === Object.keys(current).length &&
		Object.entries(query).every(([key, value]) => current[key] === value)
	if (!unchanged) router.replace({ query })
}

const setSearch = (value) => {
	const next = String(value || '').trim()
	if (next !== search.value) updateQuery({ search: next, page: undefined })
}
const setTypes = (types) => {
	const next = (types || []).join(',')
	if (next !== selectedTypes.value.join(',')) updateQuery({ types: next, page: undefined })
}
const setPage = (value) => updateQuery({ page: value > 1 ? value : undefined })
const setPageSize = (value) => updateQuery({ size: value === DEFAULT_PAGE_SIZE ? undefined : value, page: undefined })
const toggleSort = (id) => {
	const current = sort.value
	const desc = current.id === id ? !current.desc : id === 'modified'
	const isDefault = id === DEFAULT_SORT.id && desc === DEFAULT_SORT.desc
	updateQuery({ sort: isDefault ? undefined : `${desc ? '-' : ''}${id}`, page: undefined })
}

const searchInput = ref(search.value)
// Commits the box's value when the timer fires, so a late call after Clear filters or Back
// matches the URL instead of restoring the old term.
const commitSearch = useDebounceFn(() => setSearch(searchInput.value), 250)
// Back and Forward change the query without touching the box, so copy the value back in.
watch(search, (value) => {
	if (value !== searchInput.value.trim()) searchInput.value = value
})

// The Clear filters button disappears with the empty state, so move focus to the search box.
const clearFilters = () => {
	searchInput.value = ''
	updateQuery({ search: undefined, types: undefined, page: undefined })
	nextTick(() => searchField.value?.inputRef?.focus())
}

const sortIcon = (id) => {
	if (sort.value.id !== id) return 'i-lucide-arrow-up-down'
	return sort.value.desc ? 'i-lucide-arrow-down-wide-narrow' : 'i-lucide-arrow-up-narrow-wide'
}
const sortAriaLabel = ({ id, label }) =>
	sort.value.id === id
		? `${label}, sorted ${sort.value.desc ? 'descending' : 'ascending'}. Select to reverse.`
		: `Sort by ${label}`

// Rows

// Display fields are worked out once per list change rather than in every cell render.
const rows = computed(() =>
	records.value.map((record) => {
		const displayName = relativeName(record.name, zoneName.value)
		const value = formatContent(record)
		return {
			id: record.id,
			record,
			type: record.type,
			displayName,
			label: `${record.type} record ${displayName}`,
			value,
			priority: record.type === 'MX' && Number.isFinite(record.priority) ? record.priority : null,
			modified: Date.parse(record.modified_on) || 0,
			haystack: [record.name, displayName, record.content, value, record.comment]
				.filter(Boolean)
				.join('\n')
				.toLowerCase()
		}
	})
)

const filteredRows = computed(() => {
	const types = new Set(selectedTypes.value)
	const term = search.value.toLowerCase()
	return rows.value.filter((row) => (!types.size || types.has(row.type)) && (!term || row.haystack.includes(term)))
})

const collator = new Intl.Collator(LOCALE, { numeric: true, sensitivity: 'base' })
const byName = (a, b) => {
	if (a.displayName === b.displayName) return 0
	if (a.displayName === '@') return -1
	if (b.displayName === '@') return 1
	return collator.compare(a.displayName, b.displayName)
}
const COMPARATORS = {
	type: (a, b) => collator.compare(a.type, b.type) || byName(a, b),
	name: (a, b) => byName(a, b) || collator.compare(a.type, b.type),
	modified: (a, b) => a.modified - b.modified || byName(a, b)
}

const sortedRows = computed(() => {
	const compare = COMPARATORS[sort.value.id]
	const direction = sort.value.desc ? -1 : 1
	return [...filteredRows.value].sort((a, b) => compare(a, b) * direction)
})

const pageCount = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize.value)))
// Clamped only for display and only once records have loaded, so a link to page 3 isn't
// rewritten to page 1 while the list is still arriving.
const page = computed(() => (loaded.value ? Math.min(requestedPage.value, pageCount.value) : requestedPage.value))
const pageRows = computed(() => sortedRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

const typeItems = computed(() => {
	const types = new Set(rows.value.map((row) => row.type))
	for (const type of selectedTypes.value) types.add(type)
	return [...types].sort(collator.compare).map((type) => ({ label: type, value: type }))
})

const countLabel = computed(() =>
	hasFilters.value
		? `${formatNumber(sortedRows.value.length)} of ${plural(rows.value.length, 'record')}`
		: plural(rows.value.length, 'record')
)

const rangeLabel = computed(() => {
	const total = sortedRows.value.length
	const start = (page.value - 1) * pageSize.value + 1
	const end = Math.min(page.value * pageSize.value, total)
	return `${formatNumber(start)}–${formatNumber(end)} of ${formatNumber(total)}`
})

const describeFilters = () => {
	const types = selectedTypes.value.length ? typeList.format(selectedTypes.value) : ''
	if (types && search.value) return `No ${types} records contain “${search.value}”.`
	if (types) return `There are no ${types} records in ${zoneName.value || 'this zone'}.`
	return `No names, values or comments contain “${search.value}”.`
}

const emptyState = computed(() => {
	if (hasFilters.value) {
		return {
			icon: 'i-lucide-search-x',
			title: 'No records match these filters',
			description: describeFilters(),
			actions: [
				{
					label: 'Clear filters',
					icon: 'i-lucide-x',
					color: 'neutral',
					variant: 'outline',
					onClick: clearFilters
				}
			]
		}
	}
	return {
		icon: 'i-lucide-list',
		title: `${zoneName.value || 'This zone'} has no DNS records`,
		description: 'Add a record, or import a zone file exported from your previous DNS provider.',
		actions: [
			{ label: 'Add record', icon: 'i-lucide-plus', to: createLink.value },
			{
				label: 'Import zone file',
				icon: 'i-lucide-upload',
				color: 'neutral',
				variant: 'outline',
				onClick: openImport
			}
		]
	}
})

// Relative dates, refreshed every minute

const now = useNow({ interval: 60_000 })
const relativeTime = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' })
const formatRelative = (timestamp) => {
	const seconds = Math.round((timestamp - now.value.getTime()) / 1000)
	for (const [unit, size] of RELATIVE_UNITS) {
		if (Math.abs(seconds) >= size) return relativeTime.format(Math.trunc(seconds / size), unit)
	}
	return relativeTime.format(0, 'second')
}

// Columns

const isMobile = useBreakpoints(breakpointsTailwind).smaller('sm')
const hiddenColumns = useLocalStorage(STORAGE_KEYS.recordsHiddenColumns, [])
const isHidden = (id) => Array.isArray(hiddenColumns.value) && hiddenColumns.value.includes(id)

// Phones get one stacked column instead of crushed ones. Name and actions can't be hidden.
const columnVisibility = computed(() => {
	if (isMobile.value) {
		return { summary: true, type: false, name: false, value: false, ttl: false, proxied: false, modified: false }
	}
	return { summary: false, ...Object.fromEntries(HIDEABLE_COLUMNS.map(({ id }) => [id, !isHidden(id)])) }
})

const columnItems = computed(() =>
	HIDEABLE_COLUMNS.map(({ id, label }) => ({
		label,
		type: 'checkbox',
		checked: !isHidden(id),
		onUpdateChecked: (checked) => {
			const hidden = (Array.isArray(hiddenColumns.value) ? hiddenColumns.value : []).filter((item) => item !== id)
			hiddenColumns.value = checked ? hidden : [...hidden, id]
		},
		onSelect: (event) => event.preventDefault()
	}))
)

// Links and shortcuts

const recordsPath = computed(() => `/zones/${zoneId.value}/records`)
const createLink = computed(() => ({ path: `${recordsPath.value}/create`, query: route.query }))
const editLink = (recordId) => ({ path: `${recordsPath.value}/${recordId}`, query: route.query })
const panelOpen = computed(() => route.path.replace(/\/+$/, '') !== recordsPath.value)

const searchField = ref(null)
defineShortcuts({
	'/': () => {
		if (panelOpen.value) return
		searchField.value?.inputRef?.focus()
	}
})

// Selection

const rowSelection = ref({})
const getRowId = (row) => row.id

const selectedRows = computed(() => sortedRows.value.filter((row) => rowSelection.value[row.id]))
const selectedOnOtherPages = computed(
	() => selectedRows.value.length - pageRows.value.filter((row) => rowSelection.value[row.id]).length
)
const canSelectAllMatching = computed(() => selectedRows.value.length < sortedRows.value.length)
const selectAllLabel = computed(
	() => `Select all ${formatNumber(sortedRows.value.length)} ${hasFilters.value ? 'matching' : 'records'}`
)
const selectionLabel = computed(() => {
	const base = `${formatNumber(selectedRows.value.length)} selected`
	return selectedOnOtherPages.value > 0 ? `${base}, ${formatNumber(selectedOnOtherPages.value)} on other pages` : base
})

// Both toolbar buttons can disappear when pressed, so focus moves somewhere that stays.
const clearSelectionButton = useTemplateRef('clearSelectionButton')
const selectAllMatching = () => {
	rowSelection.value = Object.fromEntries(sortedRows.value.map((row) => [row.id, true]))
	nextTick(() => clearSelectionButton.value?.$el?.focus())
}
const clearSelection = () => {
	rowSelection.value = {}
}
const clearSelectionFromToolbar = () => {
	clearSelection()
	nextTick(() => searchField.value?.inputRef?.focus())
}

// A selection made under one filter mustn't quietly include records the new filter hides.
watch([search, () => selectedTypes.value.join(',')], clearSelection)

// Forget records that were deleted elsewhere, such as from the record panel.
watch(records, (list) => {
	const present = new Set(list.map((record) => record.id))
	const current = rowSelection.value
	if (Object.keys(current).some((id) => !present.has(id))) {
		rowSelection.value = Object.fromEntries(Object.entries(current).filter(([id]) => present.has(id)))
	}
})

// Row actions

const copyValue = (row) => notify.copy(row.value, 'Value')

// Keyed by record id, so a refresh or another toggle can't reset a switch that is still saving.
const pendingProxy = ref({})
const proxiedState = (record) =>
	record.id in pendingProxy.value ? pendingProxy.value[record.id] : Boolean(record.proxied)

const setProxied = async (row, value) => {
	const { id } = row
	if (id in pendingProxy.value) return
	pendingProxy.value = { ...pendingProxy.value, [id]: value }
	try {
		const response = await call(
			'patch_record',
			{ currZone: zoneId.value, currDnsRecord: id, patch: { proxied: value } },
			{ fallback: 'Cloudflare didn’t change the proxy setting' }
		)
		if (response?.result?.id) recordsApi.upsert(response.result)
	} catch (error) {
		notify.error(`Couldn’t turn the proxy ${value ? 'on' : 'off'} for ${row.displayName}`, error)
	} finally {
		const { [id]: _settled, ...rest } = pendingProxy.value
		pendingProxy.value = rest
	}
}

const propagationLink = (record) => {
	const query = { name: record.name, type: record.type, zone: zoneId.value }
	// Proxied records answer with Cloudflare's addresses, so there's no value to compare.
	if (record.proxied) {
		query.proxied = '1'
	} else {
		const expected = getExpectedDnsValue(record)
		if (expected) query.expected = expected
	}
	return { path: '/tools/propagation', query }
}

const rowActions = (row) => {
	const { record } = row
	const isWildcard = record.name.includes('*')
	const items = [
		{ label: 'Edit', icon: 'i-lucide-pencil', to: editLink(record.id) },
		{ label: 'Copy value', icon: 'i-lucide-copy', disabled: !row.value, onSelect: () => copyValue(row) }
	]
	// The stacked phone layout and a hidden Proxy column have no switch, so offer it here.
	if (record.proxiable && columnVisibility.value.proxied !== true) {
		const proxied = proxiedState(record)
		items.push({
			label: proxied ? 'Turn proxy off' : 'Turn proxy on',
			icon: proxied ? 'i-lucide-cloud-off' : 'i-lucide-cloud',
			disabled: record.id in pendingProxy.value,
			onSelect: () => setProxied(row, !proxied)
		})
	}
	if (PROPAGATION_TYPE_SET.has(record.type) && !isWildcard) {
		items.push({ label: 'Check propagation', icon: 'i-lucide-radar', to: propagationLink(record) })
	}
	if (WEB_TYPES.has(record.type) && !isWildcard) {
		items.push({
			label: 'Open in browser',
			icon: 'i-lucide-external-link',
			to: `https://${record.name}`,
			target: '_blank'
		})
	}
	return [items, [{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => openDelete([row]) }]]
}

// Delete

const deleteOpen = ref(false)
const deleteTargets = ref([])
const deleteFailures = ref({})
const deleteSummary = ref(null)
const deleting = ref(false)
const deleteDone = ref(0)

const openDelete = (targets) => {
	if (!targets.length) return
	deleteTargets.value = [...targets]
	deleteFailures.value = {}
	deleteSummary.value = null
	deleteDone.value = 0
	deleteOpen.value = true
}

const deleteTitle = computed(() =>
	deleteTargets.value.length === 1
		? `Delete ${deleteTargets.value[0].label}?`
		: `Delete ${plural(deleteTargets.value.length, 'record')}?`
)
const deleteDescription = computed(
	() =>
		`Cloudflare removes ${deleteTargets.value.length === 1 ? 'it' : 'them'} from ${zoneName.value || 'this zone'} straight away. This can’t be undone.`
)
const deleteButtonLabel = computed(() => {
	const total = deleteTargets.value.length
	if (deleting.value) return `Deleting ${formatNumber(deleteDone.value)} of ${formatNumber(total)}…`
	if (deleteSummary.value) return total === 1 ? 'Try again' : `Try ${plural(total, 'record')} again`
	return total === 1 ? 'Delete record' : `Delete ${plural(total, 'record')}`
})

const confirmDelete = async () => {
	const targets = deleteTargets.value
	const zone = zoneId.value
	if (!targets.length || deleting.value) return

	deleting.value = true
	deleteDone.value = 0
	deleteSummary.value = null
	deleteFailures.value = {}

	const deleted = []
	const failures = {}
	const queue = [...targets]
	const worker = async () => {
		while (queue.length) {
			const target = queue.shift()
			try {
				await call(
					'delete_record',
					{ currZone: zone, currDnsRecord: target.id },
					{ fallback: 'Cloudflare didn’t delete this record' }
				)
				deleted.push(target.id)
			} catch (error) {
				failures[target.id] = describeError(error, 'Cloudflare didn’t delete this record')
			} finally {
				deleteDone.value += 1
			}
		}
	}
	// A few at a time: enough to be quick on large selections without tripping rate limits.
	await Promise.all(Array.from({ length: Math.min(DELETE_CONCURRENCY, targets.length) }, worker))

	// Removing them from the shared list also drops them from the selection; failures stay selected.
	if (deleted.length) recordsApi.remove(deleted)
	deleting.value = false

	const failedTargets = targets.filter((target) => failures[target.id])
	if (!failedTargets.length) {
		deleteOpen.value = false
		notify.success(
			targets.length === 1 ? `Deleted ${targets[0].label}` : `Deleted ${plural(targets.length, 'record')}`,
			zoneName.value || undefined
		)
		return
	}

	const stillSelected = failedTargets.some((target) => rowSelection.value[target.id])
	deleteTargets.value = failedTargets
	deleteFailures.value = failures
	deleteSummary.value = {
		title: deleted.length
			? `Deleted ${formatNumber(deleted.length)} of ${plural(targets.length, 'record')}`
			: `Couldn’t delete ${targets.length === 1 ? 'this record' : plural(targets.length, 'record')}`,
		description: `${failedTargets.length === 1 ? 'The record below is' : `The ${formatNumber(failedTargets.length)} records below are`} still in the zone${stillSelected ? ' and still selected' : ''}. Cloudflare’s reason is shown under each one.`
	}
}

// Import and export

const importOpen = ref(false)
const importFile = ref(null)
const importText = ref('')
const importProxied = ref(false)
const importing = ref(false)
const importNotice = ref(null)

const openImport = () => {
	importNotice.value = null
	importOpen.value = true
}

watch(importFile, async (file) => {
	if (!file) return
	importNotice.value = null
	try {
		importText.value = await file.text()
	} catch {
		importNotice.value = {
			color: 'error',
			title: 'Couldn’t read that file',
			description: 'Choose a plain-text zone file, or paste its contents below.'
		}
	}
})

const importZone = async () => {
	if (!importText.value.trim() || importing.value) return
	importing.value = true
	importNotice.value = null
	try {
		const response = await call(
			'import_zone',
			{ currZone: zoneId.value, zoneFile: importText.value, proxied: importProxied.value },
			{ fallback: 'Cloudflare couldn’t import that zone file' }
		)
		const added = Number(response?.result?.recs_added) || 0
		const parsed = Number(response?.result?.total_records_parsed) || 0
		const title = `Added ${formatNumber(added)} of ${plural(parsed, 'parsed record')}`
		recordsApi.refresh()

		if (added > 0) {
			notify.success(title, zoneName.value || undefined)
			importOpen.value = false
			importFile.value = null
			importText.value = ''
			importProxied.value = false
			return
		}

		importNotice.value = {
			color: 'warning',
			title,
			description:
				'Cloudflare read the file but didn’t add any records. Compare them with the table before importing again.'
		}
	} catch (error) {
		importNotice.value = {
			color: 'error',
			title: 'Couldn’t import the zone file',
			description: describeError(error, 'Try again in a moment.')
		}
	} finally {
		importing.value = false
	}
}

const exporting = ref(false)

const exportZone = async () => {
	if (exporting.value) return
	exporting.value = true
	try {
		const response = await call(
			'export_zone',
			{ currZone: zoneId.value },
			{ fallback: 'Cloudflare couldn’t export this zone' }
		)
		const zoneFile = response?.result?.zoneFile
		if (typeof zoneFile !== 'string') throw new Error('Cloudflare returned no zone file. Try again.')

		const filename = `${zoneName.value || zoneId.value}.zone`
		const url = URL.createObjectURL(new Blob([zoneFile], { type: 'text/plain' }))
		const link = document.createElement('a')
		link.href = url
		link.download = filename
		document.body.append(link)
		link.click()
		link.remove()
		// Revoking in the same tick can cancel the download in some browsers.
		setTimeout(() => URL.revokeObjectURL(url), 0)
		notify.success(`Downloaded ${filename}`)
	} catch (error) {
		notify.error('Couldn’t export the zone file', error)
	} finally {
		exporting.value = false
	}
}

const moreItems = computed(() => [
	[
		{ label: 'Import zone file', icon: 'i-lucide-upload', onSelect: openImport },
		{
			label: exporting.value ? 'Exporting zone file…' : 'Export zone file',
			icon: 'i-lucide-download',
			disabled: exporting.value,
			onSelect: exportZone
		}
	],
	[
		{
			label: 'DNS lookup for this zone',
			icon: 'i-lucide-text-search',
			disabled: !zoneName.value,
			to: { path: '/tools/dns-lookup', query: { name: zoneName.value, type: 'ALL', zone: zoneId.value } }
		}
	]
])

// AI editor: only offered when the server has an OpenAI key.

const aiStatus = useState('dns-ai-editor-status', () => null)
const aiAvailable = computed(() => aiStatus.value?.available === true)
const aiOpen = ref(false)

onMounted(async () => {
	if (aiStatus.value) return
	try {
		const response = await call('ai_dns_editor/status', {}, { auth: false })
		aiStatus.value = response?.result || null
	} catch {
		// Leave the button hidden; the next visit asks again.
	}
})
</script>
