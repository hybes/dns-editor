<template>
	<UDashboardPanel id="turnstile">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span>Turnstile</span>
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
						aria-label="Refresh widgets"
						:loading="listLoading"
						@click="refreshList"
					/>
					<UButton v-if="canUse" icon="i-lucide-plus" label="Create widget" @click="openCreate" />
				</template>
			</UDashboardNavbar>

			<UDashboardToolbar v-if="canUse">
				<div class="flex w-full flex-wrap items-center gap-x-6 gap-y-2 py-2">
					<UInput
						v-model="search"
						type="search"
						icon="i-lucide-search"
						placeholder="Search names, domains and sitekeys"
						aria-label="Search widgets"
						class="w-full sm:w-80"
					/>
					<USwitch v-if="zoneName" v-model="onlyThisZone" :label="`Only widgets for ${zoneName}`" />
				</div>
			</UDashboardToolbar>
		</template>

		<template #body>
			<AccountFeatureGate
				:loaded="capabilitiesLoaded"
				:available="canUse"
				feature="Turnstile"
				:reason="accessReason"
				hint="Check that the token has Turnstile access for this account, then check again."
				:checking="zoneLoading"
				@retry="refreshZone"
			>
				<p class="text-muted text-sm">
					Turnstile widgets belong to
					{{ accountName ? `the ${accountName} account` : 'the zone’s Cloudflare account' }}, not to
					{{ zoneName || 'this zone' }}, so this list is the same for every zone in the account.
				</p>

				<UAlert
					v-if="truncated"
					color="warning"
					variant="subtle"
					icon="i-lucide-triangle-alert"
					:title="`Showing the first ${widgetList.length} of ${resultInfo?.total_count} widgets`"
					description="Search and the zone filter only cover the widgets shown here."
				/>

				<AccountResourceTable
					:data="filteredWidgets"
					:columns="columns"
					:loading="listLoading"
					:loaded="listLoaded"
					:error="listError"
					error-title="Couldn’t load Turnstile widgets"
					caption="Turnstile widgets"
					loading-label="Loading Turnstile widgets…"
					@retry="refreshList"
				>
					<template #empty>
						<UEmpty
							v-if="widgetList.length"
							variant="naked"
							icon="i-lucide-search-x"
							title="No widgets match"
							:description="noMatchDescription"
							:actions="[
								{ label: 'Clear filters', color: 'neutral', variant: 'outline', onClick: clearFilters }
							]"
						/>
						<UEmpty
							v-else
							variant="naked"
							icon="i-lucide-bot"
							title="No Turnstile widgets in this account"
							description="Create a widget to get a sitekey for your page and a secret key for your server."
							:actions="[{ label: 'Create widget', icon: 'i-lucide-plus', onClick: openCreate }]"
						/>
					</template>

					<template #name-cell="{ row }">
						<div class="flex max-w-[55vw] min-w-0 flex-col gap-0.5 sm:max-w-64">
							<button
								type="button"
								class="text-highlighted focus-visible:outline-primary truncate rounded-sm text-start font-medium hover:underline focus-visible:outline-2"
								@click="openEdit(row.original)"
							>
								{{ row.original.name }}
							</button>
							<span class="text-muted truncate text-xs md:hidden">
								{{ modeLabel(row.original.mode) }} · {{ domainSummary(row.original.domains) }}
							</span>
							<span class="text-dimmed truncate font-mono text-xs sm:hidden">{{
								row.original.sitekey
							}}</span>
						</div>
					</template>

					<template #mode-cell="{ row }">
						{{ modeLabel(row.original.mode) }}
					</template>

					<template #domains-cell="{ row }">
						<div class="flex max-w-80 flex-wrap items-center gap-1">
							<UBadge
								v-for="domain in visibleDomains(row.original)"
								:key="domain"
								:label="domain"
								color="neutral"
								variant="subtle"
							/>
							<UButton
								v-if="(row.original.domains?.length || 0) > DOMAINS_SHOWN"
								:label="
									expandedRows.has(row.original.sitekey)
										? 'Show fewer'
										: `+${row.original.domains.length - DOMAINS_SHOWN} more`
								"
								:aria-label="
									expandedRows.has(row.original.sitekey)
										? `Show fewer domains for ${row.original.name}`
										: `Show all ${row.original.domains.length} domains for ${row.original.name}`
								"
								:aria-expanded="expandedRows.has(row.original.sitekey)"
								size="xs"
								color="neutral"
								variant="link"
								@click="toggleDomains(row.original.sitekey)"
							/>
						</div>
					</template>

					<template #sitekey-cell="{ row }">
						<div class="flex items-center gap-1">
							<code class="text-default font-mono text-xs">{{ row.original.sitekey }}</code>
							<UButton
								icon="i-lucide-copy"
								size="xs"
								color="neutral"
								variant="ghost"
								:aria-label="`Copy sitekey for ${row.original.name}`"
								@click="notify.copy(row.original.sitekey, 'Sitekey')"
							/>
						</div>
					</template>

					<template #modified_on-cell="{ row }">
						<time
							v-if="formatDate(row.original.modified_on)"
							:datetime="row.original.modified_on"
							:title="formatDate(row.original.modified_on, 'full')"
						>
							{{ formatDate(row.original.modified_on) }}
						</time>
						<span v-else class="text-dimmed">Unknown</span>
					</template>

					<template #created_on-cell="{ row }">
						<time
							v-if="formatDate(row.original.created_on)"
							:datetime="row.original.created_on"
							:title="formatDate(row.original.created_on, 'full')"
						>
							{{ formatDate(row.original.created_on) }}
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
				:title="panelTitle"
				:description="panelDescription"
				:submit-label="editing ? 'Save widget' : 'Create widget'"
				:saving="saving"
				:error="saveError"
				:error-title="
					saveError === JSON_UNAPPLIED
						? 'Your JSON edits haven’t been applied'
						: editing
							? 'Cloudflare didn’t save the widget'
							: 'Cloudflare didn’t create the widget'
				"
				:dismissible="!created"
				@submit="submit"
				@after:leave="onPanelClosed"
			>
				<template v-if="created">
					<UAlert
						v-if="created.secret"
						color="warning"
						variant="subtle"
						icon="i-lucide-key-round"
						title="Copy the secret key now"
						description="Cloudflare shows it only once. If you lose it, rotate the secret in the Cloudflare dashboard."
					/>
					<UAlert
						v-else
						color="warning"
						variant="subtle"
						icon="i-lucide-key-round"
						title="Cloudflare didn’t return a secret key"
						description="Rotate the secret in the Cloudflare dashboard to get one."
					/>

					<UFormField label="Sitekey" help="Goes in the page that shows the widget.">
						<div class="flex gap-2">
							<UInput
								:model-value="created.sitekey"
								readonly
								class="min-w-0 flex-1"
								:ui="{ base: 'font-mono' }"
							/>
							<UButton
								icon="i-lucide-copy"
								label="Copy"
								color="neutral"
								variant="outline"
								:aria-label="`Copy sitekey for ${created.name}`"
								@click="notify.copy(created.sitekey, 'Sitekey')"
							/>
						</div>
					</UFormField>

					<UFormField v-if="created.secret" label="Secret key" help="Goes on your server, to verify tokens.">
						<div class="flex gap-2">
							<UInput
								:model-value="created.secret"
								readonly
								class="min-w-0 flex-1"
								:ui="{ base: 'font-mono' }"
							/>
							<UButton
								icon="i-lucide-copy"
								label="Copy"
								color="neutral"
								variant="outline"
								:aria-label="`Copy secret key for ${created.name}`"
								@click="notify.copy(created.secret, 'Secret key')"
							/>
						</div>
					</UFormField>
				</template>

				<template v-else>
					<dl v-if="editing" class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
						<dt class="text-muted">Sitekey</dt>
						<dd class="flex min-w-0 items-center gap-1">
							<code class="text-default truncate font-mono text-xs">{{ editing.sitekey }}</code>
							<UButton
								icon="i-lucide-copy"
								size="xs"
								color="neutral"
								variant="ghost"
								:aria-label="`Copy sitekey for ${editing.name}`"
								@click="notify.copy(editing.sitekey, 'Sitekey')"
							/>
						</dd>
						<template v-if="formatDate(editing.created_on)">
							<dt class="text-muted">Created</dt>
							<dd class="text-default">
								<time :datetime="editing.created_on">{{ formatDate(editing.created_on, 'full') }}</time>
							</dd>
						</template>
						<template v-if="formatDate(editing.modified_on)">
							<dt class="text-muted">Modified</dt>
							<dd class="text-default">
								<time :datetime="editing.modified_on">{{
									formatDate(editing.modified_on, 'full')
								}}</time>
								<span v-if="editing.last_modified_via" class="text-muted">
									via {{ editing.last_modified_via }}</span
								>
							</dd>
						</template>
					</dl>

					<UFormField label="Name" required :error="fieldErrors.name || false">
						<UInput
							ref="nameInput"
							v-model="form.name"
							:maxlength="254"
							placeholder="Contact form"
							autocomplete="off"
							class="w-full"
						/>
					</UFormField>

					<UFormField
						label="Domains"
						required
						description="Hostnames where the widget will run, such as example.com. Press Enter after each."
						:error="fieldErrors.domains || false"
					>
						<UInputTags
							ref="domainsInput"
							v-model="form.domains"
							:convert-value="toHostname"
							add-on-paste
							add-on-blur
							placeholder="example.com"
							class="w-full"
						/>
					</UFormField>

					<UFormField :error="fieldErrors.mode || false">
						<URadioGroup v-model="form.mode" legend="Mode" :items="MODES" />
					</UFormField>

					<UCollapsible v-model:open="advancedOpen" class="flex flex-col">
						<UButton
							label="Advanced settings"
							color="neutral"
							variant="link"
							trailing-icon="i-lucide-chevron-down"
							class="group self-start px-0"
							:ui="{
								trailingIcon: 'transition-transform duration-200 group-data-[state=open]:rotate-180'
							}"
						/>

						<template #content>
							<div class="flex flex-col gap-5 pt-3">
								<UFormField
									label="Pre-clearance"
									description="Also give visitors who pass a clearance cookie, so Cloudflare challenges up to this level on your proxied site don’t ask them again."
								>
									<USelect v-model="form.clearance_level" :items="CLEARANCE_LEVELS" class="w-full" />
								</UFormField>

								<UFormField
									label="Region"
									:description="
										editing
											? 'Set when the widget was created. Cloudflare doesn’t allow changing it.'
											: 'Where the widget can be used. This can’t be changed after the widget is created.'
									"
								>
									<USelect
										v-model="form.region"
										:items="REGIONS"
										:disabled="Boolean(editing)"
										class="w-full"
									/>
								</UFormField>

								<USwitch
									v-model="form.bot_fight_mode"
									label="Bot Fight Mode"
									description="Give suspected bots computationally expensive challenges. Enterprise plans only."
								/>
								<USwitch
									v-model="form.ephemeral_id"
									label="Ephemeral IDs"
									description="Include an ephemeral visitor ID in siteverify responses. Enterprise plans only."
								/>
								<USwitch
									v-model="form.offlabel"
									label="Hide Cloudflare branding"
									description="Remove Cloudflare branding from the widget. Enterprise plans only."
								/>
							</div>
						</template>
					</UCollapsible>

					<AccountJsonPanel
						:value="payload"
						label="Edit as JSON"
						editable
						apply-label="Apply to form"
						help="Applying replaces the form with this JSON. Fields the form doesn’t show are sent as they are."
						@apply="applyJson"
						@dirty="onJsonDirty"
					/>
				</template>

				<template v-if="created" #footer>
					<div class="flex w-full justify-end">
						<UButton label="I’ve saved the secret key" @click="panelOpen = false" />
					</div>
				</template>
			</AccountFormSlideover>

			<AccountDeleteModal
				v-model:open="deleteOpen"
				:title="deleteTarget ? `Delete ‘${deleteTarget.name}’?` : 'Delete widget?'"
				:description="
					deleteTarget
						? `Any site still using sitekey ${deleteTarget.sitekey} will stop passing Turnstile checks. This can’t be undone.`
						: ''
				"
				confirm-label="Delete widget"
				:action="deleteWidget"
			/>
		</template>
	</UDashboardPanel>
</template>

<script setup>
const MODES = [
	{
		value: 'managed',
		label: 'Managed',
		description: 'Cloudflare uses signals from the visitor to decide whether they need to tick a checkbox.'
	},
	{
		value: 'non-interactive',
		label: 'Non-interactive',
		description: 'Shows the widget while the check runs. Visitors never have to click.'
	},
	{
		value: 'invisible',
		label: 'Invisible',
		description: 'Nothing is shown. The check runs in the background.'
	}
]

const CLEARANCE_LEVELS = [
	{ value: 'no_clearance', label: 'No pre-clearance' },
	{ value: 'jschallenge', label: 'Non-interactive' },
	{ value: 'managed', label: 'Managed' },
	{ value: 'interactive', label: 'Interactive' }
]

const REGIONS = [
	{ value: 'world', label: 'Worldwide' },
	{ value: 'china', label: 'China' }
]

const defaultForm = () => ({
	name: '',
	domains: [],
	mode: 'managed',
	clearance_level: 'no_clearance',
	region: 'world',
	bot_fight_mode: false,
	ephemeral_id: false,
	offlabel: false
})

const FORM_FIELDS = Object.keys(defaultForm())
const ADVANCED_FIELDS = ['clearance_level', 'region', 'bot_fight_mode', 'ephemeral_id', 'offlabel']
const ENTERPRISE_SWITCHES = ['bot_fight_mode', 'ephemeral_id', 'offlabel']
// Set by Cloudflare, so never sent back in a create or update.
const READ_ONLY_FIELDS = ['sitekey', 'secret', 'created_on', 'modified_on', 'deployed_via', 'last_modified_via']
const DOMAINS_SHOWN = 3

const route = useRoute()
const notify = useNotify()

const {
	zoneId,
	zone,
	zoneName,
	loading: zoneLoading,
	capabilitiesLoaded,
	missingCapabilities,
	can,
	load: loadZone,
	refresh: refreshZone
} = useZone(() => route.params.zone_id)

const {
	items: widgetList,
	loading: listLoading,
	loaded: listLoaded,
	error: listError,
	resultInfo,
	truncated,
	load: loadWidgets,
	refresh: refreshList,
	create: createWidget,
	update: updateWidget,
	remove: removeWidget
} = useAccountResource(zoneId, {
	list: 'turnstile_widgets',
	item: 'turnstile_widget',
	payloadKey: 'widget',
	idKey: 'sitekey',
	label: 'Turnstile widget',
	perPage: 1000,
	// Cloudflare returns the secret only on create. The page shows it once and never keeps it.
	normalise: ({ secret: _secret, ...widget }) => widget
})

const accountName = computed(() => zone.value?.account?.name || '')
const canUse = computed(() => can('turnstile'))
const accessReason = computed(() => missingCapabilities.value.find((item) => item.key === 'turnstile')?.reason || '')

useSeoMeta({
	title: computed(() => (accountName.value ? `Turnstile · ${accountName.value}` : 'Turnstile'))
})

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
		if (id && available) loadWidgets()
	},
	{ immediate: true }
)

// --- List --------------------------------------------------------------------------------

const search = ref('')
const onlyThisZone = ref(false)
const expandedRows = ref(new Set())

// A widget covers the zone when it lists the zone's apex or one of its subdomains.
const coversZone = (widget, name) => (widget.domains || []).some((domain) => isInZone(String(domain), name))

const filteredWidgets = computed(() => {
	const query = search.value.trim().toLowerCase()
	const name = zoneName.value
	return widgetList.value
		.filter((widget) => !onlyThisZone.value || !name || coversZone(widget, name))
		.filter(
			(widget) =>
				!query ||
				[widget.name, widget.sitekey, ...(widget.domains || [])].some((value) =>
					String(value || '')
						.toLowerCase()
						.includes(query)
				)
		)
		.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
})

const noMatchDescription = computed(() => {
	const query = search.value.trim()
	if (onlyThisZone.value && query) return `No widget for ${zoneName.value} matches “${query}”.`
	if (onlyThisZone.value) return `No widget lists ${zoneName.value} or one of its subdomains.`
	return `No widget name, domain or sitekey matches “${query}”.`
})

const clearFilters = () => {
	search.value = ''
	onlyThisZone.value = false
}

const FROM_MD = { th: 'hidden md:table-cell', td: 'hidden md:table-cell' }

const columns = [
	{ accessorKey: 'name', header: 'Name' },
	{ accessorKey: 'mode', header: 'Mode', meta: { class: FROM_MD } },
	{
		accessorKey: 'domains',
		header: 'Domains',
		meta: { class: { th: 'hidden lg:table-cell', td: 'hidden whitespace-normal lg:table-cell' } }
	},
	{
		accessorKey: 'sitekey',
		header: 'Sitekey',
		meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' } }
	},
	{
		accessorKey: 'modified_on',
		header: 'Modified',
		meta: { class: { th: 'hidden xl:table-cell', td: 'hidden xl:table-cell' } }
	},
	{
		accessorKey: 'created_on',
		header: 'Created',
		meta: { class: { th: 'hidden 2xl:table-cell', td: 'hidden 2xl:table-cell' } }
	},
	{
		id: 'actions',
		header: () => h('span', { class: 'sr-only' }, 'Actions'),
		meta: { class: { td: 'w-px text-end' } }
	}
]

const modeLabel = (mode) => MODES.find((item) => item.value === mode)?.label || mode || 'Unknown mode'

const domainSummary = (domains = []) => {
	if (!domains.length) return 'No domains'
	return domains.length > 1 ? `${domains[0]} +${domains.length - 1}` : domains[0]
}

const visibleDomains = (widget) => {
	const domains = widget.domains || []
	return expandedRows.value.has(widget.sitekey) ? domains : domains.slice(0, DOMAINS_SHOWN)
}

const toggleDomains = (sitekey) => {
	if (expandedRows.value.has(sitekey)) expandedRows.value.delete(sitekey)
	else expandedRows.value.add(sitekey)
}

const rowActions = (widget) => [
	[
		{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEdit(widget) },
		{ label: 'Copy sitekey', icon: 'i-lucide-copy', onSelect: () => notify.copy(widget.sitekey, 'Sitekey') }
	],
	[{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => askDelete(widget) }]
]

// --- Create and edit ---------------------------------------------------------------------

const panelOpen = ref(false)
// The widget being edited, as Cloudflare returned it; null while creating.
const editing = ref(null)
const form = reactive(defaultForm())
// Fields that came from the widget or the JSON editor but have no control in the form.
const extraFields = ref({})
const fieldErrors = reactive({ name: '', domains: '', mode: '' })
const saveError = ref('')
const saving = ref(false)
const advancedOpen = ref(false)
// { name, sitekey, secret } from a create, shown once.
const created = ref(null)
// Edits in "Edit as JSON" that haven't been applied or discarded. Saving would leave them
// out without a word, so submit stops and asks for them to be applied or discarded first.
const jsonDirty = ref(false)
const JSON_UNAPPLIED = 'Apply them to the form or discard them, then save again.'

const onJsonDirty = (dirty) => {
	jsonDirty.value = dirty
	if (!dirty && saveError.value === JSON_UNAPPLIED) saveError.value = ''
}

const nameInput = useTemplateRef('nameInput')
const domainsInput = useTemplateRef('domainsInput')

const panelTitle = computed(() => {
	if (created.value) return `Created ${created.value.name}`
	return editing.value ? `Edit ${editing.value.name}` : 'Create a Turnstile widget'
})

const panelDescription = computed(() =>
	editing.value && !created.value ? 'Saving replaces every setting on the widget with the values below.' : ''
)

const resetErrors = () => {
	Object.assign(fieldErrors, { name: '', domains: '', mode: '' })
	saveError.value = ''
}

// Splits a widget-shaped object into form values and the fields the form doesn't show.
const splitWidget = (source) => {
	const values = defaultForm()
	const rest = {}
	for (const [key, value] of Object.entries(source || {})) {
		if (READ_ONLY_FIELDS.includes(key) || value === undefined || value === null) continue
		if (FORM_FIELDS.includes(key)) values[key] = value
		else rest[key] = value
	}
	values.name = typeof values.name === 'string' ? values.name : ''
	values.domains = Array.isArray(values.domains) ? values.domains.map(String) : []
	return { values, rest }
}

const openCreate = () => {
	editing.value = null
	created.value = null
	Object.assign(form, defaultForm(), { domains: zoneName.value ? [zoneName.value] : [] })
	extraFields.value = {}
	advancedOpen.value = false
	jsonDirty.value = false
	resetErrors()
	panelOpen.value = true
}

const openEdit = (widget) => {
	const { values, rest } = splitWidget(widget)
	editing.value = widget
	created.value = null
	Object.assign(form, values)
	extraFields.value = rest
	const defaults = defaultForm()
	advancedOpen.value = ADVANCED_FIELDS.some((key) => values[key] !== defaults[key])
	jsonDirty.value = false
	resetErrors()
	panelOpen.value = true
}

// Cloudflare's update replaces the whole widget, so an edit sends the full widget with the
// form's values merged over it. Enterprise-only switches are left out of a create unless on.
const payload = computed(() => {
	const body = {
		...extraFields.value,
		name: form.name.trim(),
		domains: [...form.domains],
		mode: form.mode,
		clearance_level: form.clearance_level,
		region: form.region
	}
	for (const key of ENTERPRISE_SWITCHES) {
		if (editing.value || form[key] !== false) body[key] = form[key]
	}
	return body
})

const applyJson = (parsed) => {
	const { values, rest } = splitWidget(parsed)
	// Region can't change on an existing widget, so keep the one Cloudflare has.
	if (editing.value) values.region = form.region
	Object.assign(form, values)
	extraFields.value = rest
	resetErrors()
}

// Accept pasted URLs by keeping only the hostname.
const toHostname = (value) =>
	String(value)
		.trim()
		.toLowerCase()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
		.replace(/[/?#].*$/, '')
		.replace(/\.$/, '')

const validate = () => {
	resetErrors()
	const name = form.name.trim()
	if (!name) fieldErrors.name = 'Enter a name so you can tell this widget apart from others'
	else if (name.length > 254) fieldErrors.name = 'Use 254 characters or fewer'

	const invalidDomain = form.domains.find((domain) => !isHostname(domain, { allowUnderscore: false }))
	if (!form.domains.length) fieldErrors.domains = 'Add at least one domain, such as example.com'
	else if (form.domains.length > 200) fieldErrors.domains = 'A widget can have up to 200 domains'
	else if (invalidDomain !== undefined) {
		fieldErrors.domains = `“${invalidDomain}” isn’t a hostname. Use a name like example.com, without https:// or a path`
	}

	if (!MODES.some((mode) => mode.value === form.mode)) fieldErrors.mode = 'Choose a mode'
	return !fieldErrors.name && !fieldErrors.domains && !fieldErrors.mode
}

const focusFirstError = async () => {
	await nextTick()
	if (fieldErrors.name) nameInput.value?.inputRef?.focus()
	else if (fieldErrors.domains) domainsInput.value?.inputRef?.focus()
}

const submit = async () => {
	if (created.value || saving.value) return
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
			const result = await updateWidget(editing.value.sitekey, payload.value)
			notify.success('Widget saved', result?.name || form.name.trim())
			panelOpen.value = false
		} else {
			const result = await createWidget(payload.value)
			created.value = {
				name: result?.name || form.name.trim(),
				sitekey: result?.sitekey || '',
				secret: result?.secret || ''
			}
		}
	} catch (error) {
		saveError.value = describeError(
			error,
			editing.value ? 'Couldn’t save the widget' : 'Couldn’t create the widget'
		)
	} finally {
		saving.value = false
	}
}

// Drop the secret and form state once the panel has finished closing.
const onPanelClosed = () => {
	created.value = null
	editing.value = null
	extraFields.value = {}
	jsonDirty.value = false
	resetErrors()
}

// --- Delete ------------------------------------------------------------------------------

const deleteOpen = ref(false)
const deleteTarget = ref(null)

const askDelete = (widget) => {
	deleteTarget.value = widget
	deleteOpen.value = true
}

const deleteWidget = async () => {
	const widget = deleteTarget.value
	if (!widget) return
	await removeWidget(widget.sitekey)
	notify.success('Widget deleted', widget.name)
	if (editing.value?.sitekey === widget.sitekey) panelOpen.value = false
}

// Panels opened for one zone's account shouldn't stay open after switching zones.
watch(zoneId, () => {
	panelOpen.value = false
	deleteOpen.value = false
	onlyThisZone.value = false
})
</script>
