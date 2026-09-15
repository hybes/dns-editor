<template>
	<UDashboardPanel id="dns-views">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span>DNS Views</span>
					<span v-if="accountName" class="text-muted hidden truncate font-normal sm:inline">
						· {{ accountName }}
					</span>
				</template>

				<template #right>
					<UButton
						v-if="canUse"
						icon="i-lucide-refresh-cw"
						color="neutral"
						variant="ghost"
						aria-label="Refresh DNS views"
						:loading="listLoading"
						@click="refreshAll"
					/>
					<UButton v-if="canUse" icon="i-lucide-plus" label="Create view" @click="openCreate" />
				</template>
			</UDashboardNavbar>

			<UDashboardToolbar v-if="canUse">
				<div class="flex w-full items-center py-2">
					<UInput
						v-model="search"
						type="search"
						icon="i-lucide-search"
						placeholder="Search view names and zones"
						aria-label="Search DNS views"
						class="w-full sm:w-80"
					/>
				</div>
			</UDashboardToolbar>
		</template>

		<template #body>
			<AccountFeatureGate
				:loaded="capabilitiesLoaded"
				:available="canUse"
				feature="DNS Views"
				:reason="accessReason"
				hint="Check that the token has access to this account’s DNS settings, then check again."
				:checking="zoneLoading"
				@retry="refreshZone"
			>
				<p class="text-muted text-sm">
					DNS views group internal zones so Gateway resolver policies can answer internal queries from them.
					Views belong to
					{{ accountName ? `the ${accountName} account` : 'the zone’s Cloudflare account' }}, so this list is
					the same for every zone in it.
				</p>

				<UAlert
					v-if="truncated"
					color="warning"
					variant="subtle"
					icon="i-lucide-triangle-alert"
					:title="`Showing the first ${viewList.length} of ${resultInfo?.total_count} views`"
					description="Search only covers the views shown here."
				/>

				<UAlert
					v-if="zonesError && viewList.some((view) => view.zones?.length)"
					color="warning"
					variant="subtle"
					icon="i-lucide-triangle-alert"
					title="Couldn’t load internal zone names"
					:description="`${zonesError} Zones are shown by ID until the names load.`"
					:actions="[
						{
							label: 'Try again',
							icon: 'i-lucide-refresh-cw',
							color: 'neutral',
							variant: 'outline',
							loading: zonesLoading,
							onClick: () => loadInternalZones({ force: true })
						}
					]"
				/>

				<AccountResourceTable
					:data="filteredViews"
					:columns="columns"
					:loading="listLoading"
					:loaded="listLoaded"
					:error="listError"
					error-title="Couldn’t load DNS views"
					caption="DNS views"
					loading-label="Loading DNS views…"
					@retry="refreshList"
				>
					<template #empty>
						<UEmpty
							v-if="viewList.length"
							variant="naked"
							icon="i-lucide-search-x"
							title="No views match"
							:description="`No view name or zone matches “${search.trim()}”.`"
							:actions="[
								{ label: 'Clear search', color: 'neutral', variant: 'outline', onClick: clearSearch }
							]"
						/>
						<UEmpty
							v-else
							variant="naked"
							icon="i-lucide-split"
							title="No DNS views in this account"
							description="Create a view to group internal zones, then reference it from a Gateway resolver policy."
							:actions="[{ label: 'Create view', icon: 'i-lucide-plus', onClick: openCreate }]"
						/>
					</template>

					<template #name-cell="{ row }">
						<div class="flex max-w-[60vw] min-w-0 flex-col gap-0.5 sm:max-w-72">
							<button
								type="button"
								class="text-highlighted focus-visible:outline-primary truncate rounded-sm text-start font-medium hover:underline focus-visible:outline-2"
								@click="openEdit(row.original)"
							>
								{{ row.original.name }}
							</button>
							<span class="text-muted truncate text-xs md:hidden">{{ zoneSummary(row.original) }}</span>
						</div>
					</template>

					<template #zones-cell="{ row }">
						<span v-if="!row.original.zones?.length" class="text-dimmed">No zones</span>
						<div v-else class="flex max-w-96 flex-wrap items-center gap-1">
							<UBadge
								v-for="linked in visibleZones(row.original)"
								:key="linked.id"
								:label="linked.name || linked.id"
								:title="linked.name ? linked.id : 'Zone name not found'"
								color="neutral"
								variant="subtle"
								:class="linked.name ? '' : 'font-mono'"
							/>
							<UButton
								v-if="row.original.zones.length > ZONES_SHOWN"
								:label="
									expandedRows.has(row.original.id)
										? 'Show fewer'
										: `+${row.original.zones.length - ZONES_SHOWN} more`
								"
								:aria-label="
									expandedRows.has(row.original.id)
										? `Show fewer zones for ${row.original.name}`
										: `Show all ${row.original.zones.length} zones for ${row.original.name}`
								"
								:aria-expanded="expandedRows.has(row.original.id)"
								size="xs"
								color="neutral"
								variant="link"
								@click="toggleZones(row.original.id)"
							/>
						</div>
					</template>

					<template #modified_time-cell="{ row }">
						<time
							v-if="formatDate(row.original.modified_time)"
							:datetime="row.original.modified_time"
							:title="formatDate(row.original.modified_time, 'full')"
						>
							{{ formatDate(row.original.modified_time) }}
						</time>
						<span v-else class="text-dimmed">Unknown</span>
					</template>

					<template #created_time-cell="{ row }">
						<time
							v-if="formatDate(row.original.created_time)"
							:datetime="row.original.created_time"
							:title="formatDate(row.original.created_time, 'full')"
						>
							{{ formatDate(row.original.created_time) }}
						</time>
						<span v-else class="text-dimmed">Unknown</span>
					</template>

					<template #actions-cell="{ row }">
						<div class="flex justify-end">
							<UDropdownMenu :items="rowActions(row.original)" :content="{ align: 'end' }">
								<UButton
									icon="i-lucide-ellipsis-vertical"
									color="neutral"
									variant="ghost"
									:aria-label="`Actions for ${row.original.name}`"
								/>
							</UDropdownMenu>
						</div>
					</template>
				</AccountResourceTable>
			</AccountFeatureGate>

			<AccountFormSlideover
				v-model:open="panelOpen"
				:title="editing ? `Edit ${editing.name}` : 'Create a DNS view'"
				:submit-label="editing ? 'Save view' : 'Create view'"
				:saving="saving"
				:error="saveError"
				:error-title="
					saveError === JSON_UNAPPLIED
						? 'Your JSON edits haven’t been applied'
						: editing
							? 'Cloudflare didn’t save the view'
							: 'Cloudflare didn’t create the view'
				"
				@submit="submit"
				@after:leave="onPanelClosed"
			>
				<dl v-if="editing" class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
					<dt class="text-muted">View ID</dt>
					<dd class="flex min-w-0 items-center gap-1">
						<code class="text-default truncate font-mono text-xs">{{ editing.id }}</code>
						<UButton
							icon="i-lucide-copy"
							size="xs"
							color="neutral"
							variant="ghost"
							:aria-label="`Copy view ID for ${editing.name}`"
							@click="notify.copy(editing.id, 'View ID')"
						/>
					</dd>
					<template v-if="formatDate(editing.created_time)">
						<dt class="text-muted">Created</dt>
						<dd class="text-default">
							<time :datetime="editing.created_time">{{ formatDate(editing.created_time, 'full') }}</time>
						</dd>
					</template>
					<template v-if="formatDate(editing.modified_time)">
						<dt class="text-muted">Modified</dt>
						<dd class="text-default">
							<time :datetime="editing.modified_time">{{
								formatDate(editing.modified_time, 'full')
							}}</time>
						</dd>
					</template>
				</dl>

				<UFormField label="Name" required :error="fieldErrors.name || false">
					<UInput
						ref="nameInput"
						v-model="form.name"
						:maxlength="255"
						placeholder="Office network"
						autocomplete="off"
						class="w-full"
					/>
				</UFormField>

				<UAlert
					v-if="zonesError"
					color="warning"
					variant="subtle"
					icon="i-lucide-triangle-alert"
					title="Couldn’t list this account’s internal zones"
					:description="`${zonesError} You can still add a zone by pasting its ID.`"
					:actions="[
						{
							label: 'Try again',
							icon: 'i-lucide-refresh-cw',
							color: 'neutral',
							variant: 'outline',
							loading: zonesLoading,
							onClick: () => loadInternalZones({ force: true })
						}
					]"
				/>

				<UFormField label="Internal zones" :description="zonesDescription" :error="fieldErrors.zones || false">
					<USelectMenu
						ref="zonesInput"
						v-model="form.zones"
						:items="zoneOptions"
						multiple
						value-key="id"
						label-key="name"
						:filter-fields="['name', 'id']"
						:loading="zonesLoading"
						:create-item="{ when: 'empty' }"
						:search-input="{ placeholder: 'Search by name or paste a zone ID' }"
						class="w-full"
						@create="addZoneId"
					>
						<template #default="{ modelValue }">
							<span v-if="modelValue?.length" class="truncate">
								{{
									modelValue.length === 1 ? '1 zone selected' : `${modelValue.length} zones selected`
								}}
							</span>
							<span v-else class="text-dimmed truncate">Choose internal zones</span>
						</template>

						<template #empty="{ searchTerm }">
							<span v-if="searchTerm">No internal zone matches “{{ searchTerm }}”</span>
							<span v-else-if="zonesLoading">Loading internal zones…</span>
							<span v-else>This account has no internal zones</span>
						</template>

						<template #create-item-label="{ item }">Add zone ID “{{ item }}”</template>
					</USelectMenu>

					<ul v-if="form.zones.length" class="divide-default mt-2 divide-y" aria-label="Zones in this view">
						<li v-for="id in form.zones" :key="id" class="flex items-center justify-between gap-2 py-1.5">
							<div class="flex min-w-0 flex-col">
								<span v-if="zoneNameFor(id)" class="text-highlighted truncate text-sm">{{
									zoneNameFor(id)
								}}</span>
								<span v-else class="text-muted text-sm">Zone name not found</span>
								<code class="text-dimmed truncate font-mono text-xs">{{ id }}</code>
							</div>
							<UButton
								icon="i-lucide-x"
								size="xs"
								color="neutral"
								variant="ghost"
								:aria-label="`Remove ${zoneNameFor(id) || id} from the view`"
								@click="removeZone(id)"
							/>
						</li>
					</ul>
				</UFormField>

				<AccountJsonPanel
					:value="jsonValue"
					label="Edit as JSON"
					editable
					apply-label="Apply to form"
					:help="
						editing
							? 'Applying replaces the form with this JSON. Saving sends only the fields that differ from the saved view.'
							: 'Applying replaces the form with this JSON. Fields the form doesn’t show are sent as they are.'
					"
					@apply="applyJson"
					@dirty="onJsonDirty"
				/>
			</AccountFormSlideover>

			<AccountDeleteModal
				v-model:open="deleteOpen"
				:title="deleteTarget ? `Delete ‘${deleteTarget.name}’?` : 'Delete view?'"
				description="Its internal zones stay in the account but are unlinked from the view. Gateway resolver policies that still use this view will answer matching queries with SERVFAIL. This can’t be undone."
				confirm-label="Delete view"
				:action="deleteView"
			/>
		</template>
	</UDashboardPanel>
</template>

<script setup>
const ZONES_SHOWN = 3
// Set by Cloudflare, so never sent back in a create or update.
const READ_ONLY_FIELDS = ['id', 'created_time', 'modified_time']
// Zone IDs are 32 hex characters; checking the shape catches a pasted zone name.
const ZONE_ID_PATTERN = /^[0-9a-f]{32}$/i
const MAX_NAME_LENGTH = 255

const route = useRoute()
const notify = useNotify()
const { call } = useCfApi()
const { findZone } = useZones()

const {
	zoneId,
	zone,
	loading: zoneLoading,
	capabilitiesLoaded,
	missingCapabilities,
	can,
	load: loadZone,
	refresh: refreshZone
} = useZone(() => route.params.zone_id)

const {
	items: viewList,
	loading: listLoading,
	loaded: listLoaded,
	error: listError,
	resultInfo,
	truncated,
	load: loadViews,
	refresh: refreshList,
	create: createView,
	update: updateView,
	remove: removeView
} = useAccountResource(zoneId, {
	list: 'dns_views',
	item: 'dns_view',
	payloadKey: 'view',
	idParam: 'viewId',
	label: 'DNS view',
	perPage: 1000
})

const accountName = computed(() => zone.value?.account?.name || '')
const canUse = computed(() => can('dnsViews'))
const accessReason = computed(() => missingCapabilities.value.find((item) => item.key === 'dnsViews')?.reason || '')

useSeoMeta({
	title: computed(() => (accountName.value ? `DNS Views · ${accountName.value}` : 'DNS Views'))
})

// --- Internal zones ----------------------------------------------------------------------

// Views can only link internal zones, which the shared zones list doesn't include, so the
// page asks for the account's internal zones itself.
const internalZones = ref([])
const zonesTotal = ref(0)
const zonesLoading = ref(false)
const zonesLoaded = ref(false)
const zonesError = ref('')
const zonesFor = ref('')
let zonesRequest = 0

const loadInternalZones = async ({ force = false } = {}) => {
	const id = zoneId.value
	if (!id) return
	if (!force && zonesFor.value === id && (zonesLoaded.value || zonesLoading.value)) return

	const request = ++zonesRequest
	if (zonesFor.value !== id) {
		internalZones.value = []
		zonesTotal.value = 0
		zonesLoaded.value = false
	}
	zonesFor.value = id
	zonesLoading.value = true
	zonesError.value = ''

	try {
		const response = await call(
			'dns_views',
			{ currZone: id, action: 'internal_zones', fresh: force },
			{ fallback: 'Couldn’t list internal zones' }
		)
		if (request !== zonesRequest) return
		internalZones.value = response?.result || []
		zonesTotal.value = Number(response?.result_info?.total_count) || internalZones.value.length
		zonesLoaded.value = true
	} catch (error) {
		if (request === zonesRequest) zonesError.value = describeError(error, 'Couldn’t list internal zones')
	} finally {
		if (request === zonesRequest) zonesLoading.value = false
	}
}

const internalZoneById = computed(() => new Map(internalZones.value.map((item) => [item.id, item])))

const zoneNameFor = (id) => internalZoneById.value.get(id)?.name || findZone(id)?.name || ''

watch(
	zoneId,
	(id) => {
		if (id) loadZone()
	},
	{ immediate: true }
)

watch(
	[zoneId, canUse],
	([id, available]) => {
		if (!id || !available) return
		loadViews()
		loadInternalZones()
	},
	{ immediate: true }
)

const refreshAll = () => {
	refreshList()
	loadInternalZones({ force: true })
}

// --- List --------------------------------------------------------------------------------

const search = ref('')
const expandedRows = ref(new Set())

const filteredViews = computed(() => {
	const query = search.value.trim().toLowerCase()
	return viewList.value
		.filter(
			(view) =>
				!query ||
				[view.name, view.id, ...(view.zones || []).flatMap((id) => [id, zoneNameFor(id)])].some((value) =>
					String(value || '')
						.toLowerCase()
						.includes(query)
				)
		)
		.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
})

const clearSearch = () => {
	search.value = ''
}

const columns = [
	{ accessorKey: 'name', header: 'Name' },
	{
		accessorKey: 'zones',
		header: 'Zones',
		meta: { class: { th: 'hidden md:table-cell', td: 'hidden whitespace-normal md:table-cell' } }
	},
	{
		accessorKey: 'modified_time',
		header: 'Modified',
		meta: { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' } }
	},
	{
		accessorKey: 'created_time',
		header: 'Created',
		meta: { class: { th: 'hidden xl:table-cell', td: 'hidden xl:table-cell' } }
	},
	{
		id: 'actions',
		header: () => h('span', { class: 'sr-only' }, 'Actions'),
		meta: { class: { td: 'w-px text-end' } }
	}
]

const zoneSummary = (view) => {
	const zones = view.zones || []
	if (!zones.length) return 'No zones'
	const first = zoneNameFor(zones[0]) || zones[0]
	return zones.length > 1 ? `${first} +${zones.length - 1}` : first
}

const visibleZones = (view) => {
	const zones = view.zones || []
	const shown = expandedRows.value.has(view.id) ? zones : zones.slice(0, ZONES_SHOWN)
	return shown.map((id) => ({ id, name: zoneNameFor(id) }))
}

const toggleZones = (viewId) => {
	if (expandedRows.value.has(viewId)) expandedRows.value.delete(viewId)
	else expandedRows.value.add(viewId)
}

const rowActions = (view) => [
	[
		{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEdit(view) },
		{ label: 'Copy view ID', icon: 'i-lucide-copy', onSelect: () => notify.copy(view.id, 'View ID') }
	],
	[{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => askDelete(view) }]
]

// --- Create and edit ---------------------------------------------------------------------

const panelOpen = ref(false)
// The view being edited, as Cloudflare returned it; null while creating.
const editing = ref(null)
const form = reactive({ name: '', zones: [] })
// Fields from the JSON editor that have no control in the form.
const extraFields = ref({})
const fieldErrors = reactive({ name: '', zones: '' })
const saveError = ref('')
const saving = ref(false)
// Edits in "Edit as JSON" that haven't been applied or discarded. Saving would leave them
// out without a word, so submit stops and asks for them to be applied or discarded first.
const jsonDirty = ref(false)
const JSON_UNAPPLIED = 'Apply them to the form or discard them, then save again.'

const onJsonDirty = (dirty) => {
	jsonDirty.value = dirty
	if (!dirty && saveError.value === JSON_UNAPPLIED) saveError.value = ''
}

const nameInput = useTemplateRef('nameInput')
const zonesInput = useTemplateRef('zonesInput')

// Internal zones plus any selected ID the list doesn't contain, so editing a view never
// drops a zone just because its name couldn't be found. Duplicate names show their ID.
const zoneOptions = computed(() => {
	const counts = new Map()
	for (const item of internalZones.value) counts.set(item.name, (counts.get(item.name) || 0) + 1)
	const options = internalZones.value.map((item) => ({
		id: item.id,
		name: item.name || item.id,
		description: counts.get(item.name) > 1 ? item.id : undefined
	}))
	for (const id of form.zones) {
		if (!internalZoneById.value.has(id)) {
			options.push({ id, name: findZone(id)?.name || id, description: 'Not in this account’s internal zones' })
		}
	}
	return options
})

const zonesDescription = computed(() => {
	const base =
		'Queries for these zones resolve through this view. A view can be empty, and a zone can be in several views.'
	if (zonesLoaded.value && zonesTotal.value > internalZones.value.length) {
		return `${base} Only the first ${internalZones.value.length} of ${zonesTotal.value} internal zones are listed; paste an ID to add another.`
	}
	return base
})

const jsonValue = computed(() => ({ ...extraFields.value, name: form.name.trim(), zones: [...form.zones] }))

const resetErrors = () => {
	Object.assign(fieldErrors, { name: '', zones: '' })
	saveError.value = ''
}

const uniqueIds = (values) => [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]

// Splits a view-shaped object into form values and the fields the form doesn't show.
const splitView = (source) => {
	const values = { name: '', zones: [] }
	const rest = {}
	let zonesInvalid = false
	for (const [key, value] of Object.entries(source || {})) {
		if (READ_ONLY_FIELDS.includes(key) || value === undefined) continue
		if (key === 'name') values.name = typeof value === 'string' ? value : ''
		else if (key === 'zones') {
			if (Array.isArray(value)) values.zones = uniqueIds(value)
			else zonesInvalid = value !== null
		} else rest[key] = value
	}
	return { values, rest, zonesInvalid }
}

const openCreate = () => {
	editing.value = null
	Object.assign(form, { name: '', zones: [] })
	extraFields.value = {}
	jsonDirty.value = false
	resetErrors()
	panelOpen.value = true
	loadInternalZones()
}

const openEdit = (view) => {
	const { values, rest } = splitView(view)
	editing.value = view
	Object.assign(form, values)
	extraFields.value = rest
	jsonDirty.value = false
	resetErrors()
	panelOpen.value = true
	loadInternalZones()
}

const applyJson = (parsed) => {
	const { values, rest, zonesInvalid } = splitView(parsed)
	Object.assign(form, values)
	extraFields.value = rest
	resetErrors()
	if (zonesInvalid) fieldErrors.zones = 'In the JSON, zones must be a list of zone IDs. The zone list was cleared.'
}

const addZoneId = (term) => {
	const id = String(term || '').trim()
	if (!ZONE_ID_PATTERN.test(id)) {
		fieldErrors.zones = `“${id}” isn’t a zone ID. Pick a zone from the list, or paste its 32-character ID.`
		return
	}
	if (!form.zones.includes(id)) form.zones = [...form.zones, id]
	fieldErrors.zones = ''
}

const removeZone = (id) => {
	form.zones = form.zones.filter((existing) => existing !== id)
}

const sameZones = (a = [], b = []) => a.length === b.length && a.every((id) => b.includes(id))

// PATCH only sends what changed, so an edit never overwrites a field someone else updated.
const changedFields = () => {
	const original = editing.value || {}
	const changes = {}
	const name = form.name.trim()
	if (name !== original.name) changes.name = name
	if (!sameZones(form.zones, original.zones || [])) changes.zones = [...form.zones]
	for (const [key, value] of Object.entries(extraFields.value)) {
		if (JSON.stringify(value) !== JSON.stringify(original[key])) changes[key] = value
	}
	return changes
}

const validate = () => {
	resetErrors()
	const name = form.name.trim()
	if (!name) fieldErrors.name = 'Enter a name so you can pick this view in a resolver policy'
	else if (name.length > MAX_NAME_LENGTH) fieldErrors.name = `Use ${MAX_NAME_LENGTH} characters or fewer`
	else if (viewList.value.some((view) => view.id !== editing.value?.id && view.name === name)) {
		fieldErrors.name = `Another view in this account is already called “${name}”. View names must be unique.`
	}

	// Two internal zones can share a name, but not inside the same view.
	const seen = new Set()
	for (const id of form.zones) {
		const label = internalZoneById.value.get(id)?.name
		if (!label) continue
		if (seen.has(label)) {
			fieldErrors.zones = `Two selected zones are called ${label}. A view can hold only one zone with each name.`
			break
		}
		seen.add(label)
	}

	return !fieldErrors.name && !fieldErrors.zones
}

const focusFirstError = async () => {
	await nextTick()
	if (fieldErrors.name) nameInput.value?.inputRef?.focus()
	else if (fieldErrors.zones) zonesInput.value?.triggerRef?.focus?.()
}

// The server names the field in its 400s ("Name is required", "Zones: …"), so those go
// next to the field instead of the alert.
const showSaveError = (error) => {
	const message = describeError(error, editing.value ? 'Couldn’t save the view' : 'Couldn’t create the view')
	if (isInputError(error) && /^Name\b/.test(message)) fieldErrors.name = message
	else if (isInputError(error) && /^Zones\b/.test(message)) fieldErrors.zones = message
	else saveError.value = message
}

const submit = async () => {
	if (saving.value) return
	if (jsonDirty.value) {
		saveError.value = JSON_UNAPPLIED
		return
	}
	if (!validate()) {
		focusFirstError()
		return
	}

	saving.value = true
	try {
		if (editing.value) {
			const changes = changedFields()
			// Nothing to send; closing matches what saving would have left behind.
			if (Object.keys(changes).length) {
				const result = await updateView(editing.value.id, changes)
				notify.success('View saved', result?.name || form.name.trim())
			}
		} else {
			const result = await createView({ ...extraFields.value, name: form.name.trim(), zones: [...form.zones] })
			notify.success('View created', result?.name || form.name.trim())
		}
		panelOpen.value = false
	} catch (error) {
		showSaveError(error)
	} finally {
		saving.value = false
	}
}

const onPanelClosed = () => {
	editing.value = null
	extraFields.value = {}
	jsonDirty.value = false
	resetErrors()
}

// --- Delete ------------------------------------------------------------------------------

const deleteOpen = ref(false)
const deleteTarget = ref(null)

const askDelete = (view) => {
	deleteTarget.value = view
	deleteOpen.value = true
}

const deleteView = async () => {
	const view = deleteTarget.value
	if (!view) return
	await removeView(view.id)
	notify.success('View deleted', view.name)
	if (editing.value?.id === view.id) panelOpen.value = false
}

// Panels opened for one zone's account shouldn't stay open after switching zones.
watch(zoneId, () => {
	panelOpen.value = false
	deleteOpen.value = false
	search.value = ''
	expandedRows.value = new Set()
})
</script>
