<template>
	<UDashboardPanel id="dns-firewall">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span>DNS Firewall</span>
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
						aria-label="Refresh clusters"
						:loading="listLoading"
						@click="refreshList"
					/>
					<UButton v-if="canUse" icon="i-lucide-plus" label="Create cluster" @click="openCreate" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<AccountFeatureGate
				:loaded="capabilitiesLoaded"
				:available="canUse"
				feature="DNS Firewall"
				:reason="accessReason"
				hint="DNS Firewall needs an Enterprise account with DNS Firewall enabled, and a token with DNS Firewall access for that account."
				:checking="zoneLoading"
				@retry="refreshZone"
			>
				<p class="text-muted text-sm">
					DNS Firewall clusters proxy and cache DNS queries for your upstream name servers. They belong to
					{{ accountName ? `the ${accountName} account` : 'the zone’s Cloudflare account' }}, not to
					{{ zoneName || 'this zone' }}, so this list is the same for every zone in the account.
				</p>

				<UAlert
					v-if="truncated"
					color="warning"
					variant="subtle"
					icon="i-lucide-triangle-alert"
					:title="`Showing the first ${clusterList.length} of ${resultInfo?.total_count} clusters`"
					description="Cloudflare returns up to 100 clusters at a time. Manage the rest in the Cloudflare dashboard."
				/>

				<AccountResourceTable
					:data="sortedClusters"
					:columns="columns"
					:loading="listLoading"
					:loaded="listLoaded"
					:error="listError"
					error-title="Couldn’t load DNS Firewall clusters"
					caption="DNS Firewall clusters"
					loading-label="Loading DNS Firewall clusters…"
					@retry="refreshList"
				>
					<template #empty>
						<UEmpty
							variant="naked"
							icon="i-lucide-shield"
							title="No DNS Firewall clusters in this account"
							description="Create a cluster for your upstream name servers. Cloudflare assigns it DNS Firewall IPs to use as the name server addresses for your domains."
							:actions="[{ label: 'Create cluster', icon: 'i-lucide-plus', onClick: openCreate }]"
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
							<span class="text-muted truncate text-xs sm:hidden">
								DNS Firewall:
								<span class="font-mono">{{ ipSummary(row.original.dns_firewall_ips) }}</span>
							</span>
							<span class="text-muted truncate text-xs md:hidden">
								Upstream: <span class="font-mono">{{ ipSummary(row.original.upstream_ips) }}</span>
							</span>
						</div>
					</template>

					<template v-for="column in IP_COLUMNS" #[column.slot]="{ row }">
						<div v-if="row.original[column.key]?.length" :key="column.key" class="flex items-start gap-1">
							<div class="flex flex-col items-start gap-0.5">
								<ul
									class="text-default flex flex-col gap-0.5 font-mono text-xs"
									:aria-label="`${column.label} for ${row.original.name}`"
								>
									<li v-for="ip in visibleIps(row.original, column.key)" :key="ip">{{ ip }}</li>
								</ul>
								<UButton
									v-if="row.original[column.key].length > IPS_SHOWN"
									:label="
										isExpanded(row.original, column.key)
											? 'Show fewer'
											: `+${row.original[column.key].length - IPS_SHOWN} more`
									"
									:aria-label="
										isExpanded(row.original, column.key)
											? `Show fewer ${column.label} for ${row.original.name}`
											: `Show all ${row.original[column.key].length} ${column.label} for ${row.original.name}`
									"
									:aria-expanded="isExpanded(row.original, column.key)"
									size="xs"
									color="neutral"
									variant="link"
									class="px-0"
									@click="toggleIps(row.original, column.key)"
								/>
							</div>
							<UButton
								v-if="column.copy"
								icon="i-lucide-copy"
								size="xs"
								color="neutral"
								variant="ghost"
								:aria-label="`Copy ${column.label} for ${row.original.name}`"
								@click="copyFirewallIps(row.original)"
							/>
						</div>
						<span v-else :key="`${column.key}-empty`" class="text-dimmed">{{ column.empty }}</span>
					</template>

					<template #cache-cell="{ row }">
						<div class="flex flex-col gap-0.5">
							<span>{{ cacheRange(row.original) }}</span>
							<span class="text-muted text-xs">
								Negative answers: {{ formatTtl(row.original.negative_cache_ttl) || 'not set' }}
							</span>
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
				:title="editing ? `Edit ${editing.name}` : 'Create a DNS Firewall cluster'"
				:description="editing ? 'Saving sends only the settings you change.' : ''"
				:submit-label="editing ? 'Save cluster' : 'Create cluster'"
				:saving="saving"
				:error="saveError"
				:error-title="
					saveError === JSON_UNAPPLIED
						? 'Your JSON edits haven’t been applied'
						: editing
							? 'Cloudflare didn’t save the cluster'
							: 'Cloudflare didn’t create the cluster'
				"
				@submit="submit"
				@after:leave="onPanelClosed"
			>
				<div ref="fieldsRoot" class="flex flex-col gap-5">
					<UAlert
						v-if="justCreated"
						color="success"
						variant="subtle"
						icon="i-lucide-circle-check"
						title="Cluster created"
						:description="
							editing?.dns_firewall_ips?.length
								? 'Cloudflare assigned the DNS Firewall IPs below. Use them as the name server addresses for your domains.'
								: 'Cloudflare didn’t return DNS Firewall IPs for it. Refresh the list to check again.'
						"
					/>

					<dl v-if="editing" class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
						<dt class="text-muted">DNS Firewall IPs</dt>
						<dd class="flex min-w-0 items-start gap-1">
							<template v-if="editing.dns_firewall_ips?.length">
								<ul class="text-default flex min-w-0 flex-col gap-0.5 font-mono text-xs">
									<li v-for="ip in editing.dns_firewall_ips" :key="ip" class="break-all">{{ ip }}</li>
								</ul>
								<UButton
									icon="i-lucide-copy"
									size="xs"
									color="neutral"
									variant="ghost"
									:aria-label="`Copy DNS Firewall IPs for ${editing.name}`"
									@click="copyFirewallIps(editing)"
								/>
							</template>
							<span v-else class="text-dimmed">None assigned</span>
						</dd>

						<dt class="text-muted">Cluster ID</dt>
						<dd class="flex min-w-0 items-center gap-1">
							<code class="text-default truncate font-mono text-xs">{{ editing.id }}</code>
							<UButton
								icon="i-lucide-copy"
								size="xs"
								color="neutral"
								variant="ghost"
								:aria-label="`Copy cluster ID for ${editing.name}`"
								@click="notify.copy(editing.id, 'Cluster ID')"
							/>
						</dd>

						<template v-if="formatDate(editing.modified_on)">
							<dt class="text-muted">Modified</dt>
							<dd class="text-default">
								<time :datetime="editing.modified_on">{{
									formatDate(editing.modified_on, 'full')
								}}</time>
							</dd>
						</template>
					</dl>

					<UFormField label="Name" required :error="fieldErrors.name || false">
						<UInput
							v-model="form.name"
							:maxlength="160"
							placeholder="Primary name servers"
							autocomplete="off"
							class="w-full"
						/>
					</UFormField>

					<UFormField
						label="Upstream IPs"
						required
						description="The name servers DNS Firewall forwards queries to, as IPv4 or IPv6 addresses. Press Enter or space after each."
						:error="fieldErrors.upstream_ips || false"
					>
						<UInputTags
							:model-value="form.upstream_ips"
							:convert-value="cleanIp"
							:delimiter="IP_DELIMITER"
							add-on-paste
							add-on-blur
							placeholder="192.0.2.53"
							class="w-full"
							:ui="{ itemText: 'font-mono' }"
							@update:model-value="setUpstreamIps"
						/>
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
							<div class="flex flex-col gap-6 pt-3">
								<fieldset v-for="group in NUMBER_GROUPS" :key="group.legend">
									<legend class="text-highlighted pb-3 text-sm font-medium">
										{{ group.legend }}
									</legend>
									<div class="flex flex-col gap-4">
										<UFormField
											v-for="key in group.keys"
											:key="key"
											:label="NUMBER_FIELDS[key].label"
											:description="numberDescription(key)"
											:error="fieldErrors[key] || false"
										>
											<UInputNumber
												v-model="form[key]"
												:min="NUMBER_FIELDS[key].min"
												:max="NUMBER_FIELDS[key].max"
												:step="NUMBER_FIELDS[key].step || 1"
												:step-snapping="false"
												:placeholder="editing ? 'Not set' : 'Cloudflare default'"
												class="w-full"
											/>
										</UFormField>
									</div>
								</fieldset>

								<fieldset>
									<legend class="text-highlighted pb-3 text-sm font-medium">Query handling</legend>
									<div class="flex flex-col gap-4">
										<USwitch
											v-model="form.ecs_fallback"
											label="EDNS Client Subnet fallback"
											description="When a query has no EDNS Client Subnet, forward the resolver’s subnet instead."
										/>
										<USwitch
											v-model="form.deprecate_any_requests"
											label="Refuse ANY queries"
											description="Refuse queries for the ANY type instead of answering them."
										/>
									</div>
								</fieldset>

								<fieldset>
									<legend class="text-highlighted pb-3 text-sm font-medium">Attack mitigation</legend>
									<div class="flex flex-col gap-4">
										<USwitch
											v-model="form.attack_mitigation_enabled"
											label="Mitigate random-prefix attacks"
											description="Cloudflare mitigates random-prefix attacks automatically."
										/>
										<USwitch
											v-model="form.attack_mitigation_unhealthy_only"
											label="Only when upstream servers seem unhealthy"
											:disabled="!form.attack_mitigation_enabled"
										/>
									</div>
								</fieldset>
							</div>
						</template>
					</UCollapsible>

					<AccountJsonPanel
						:value="desired"
						label="Edit as JSON"
						editable
						apply-label="Apply to form"
						:help="
							editing
								? 'Applying replaces the form with this JSON. Saving sends only the fields that differ from the cluster.'
								: 'Applying replaces the form with this JSON. Fields the form doesn’t show, such as dns_firewall_ip_count, are sent as they are.'
						"
						@apply="applyJson"
						@dirty="onJsonDirty"
					/>
				</div>
			</AccountFormSlideover>

			<AccountDeleteModal
				v-model:open="deleteOpen"
				:title="deleteTarget ? `Delete ‘${deleteTarget.name}’?` : 'Delete cluster?'"
				description="Domains that use its DNS Firewall IPs as name servers will stop resolving through this cluster. This can’t be undone."
				confirm-label="Delete cluster"
				:action="deleteCluster"
			>
				<template v-if="deleteTarget?.dns_firewall_ips?.length">
					<p class="text-muted">DNS Firewall IPs for this cluster:</p>
					<ul class="mt-1 flex flex-col gap-0.5 font-mono text-xs">
						<li v-for="ip in deleteTarget.dns_firewall_ips" :key="ip" class="break-all">{{ ip }}</li>
					</ul>
				</template>
			</AccountDeleteModal>
		</template>
	</UDashboardPanel>
</template>

<script setup>
const TTL_RANGE = { min: 30, max: 36_000 }

// Cloudflare's limits for each numeric setting. `clearable` settings accept null in an
// update; the others can only be replaced with another value once set.
const NUMBER_FIELDS = {
	minimum_cache_ttl: {
		label: 'Minimum cache TTL (seconds)',
		description: 'Shorter TTLs from the upstream servers are raised to this for caching.',
		...TTL_RANGE,
		clearable: false
	},
	maximum_cache_ttl: {
		label: 'Maximum cache TTL (seconds)',
		description: 'Longer TTLs from the upstream servers are lowered to this for caching.',
		...TTL_RANGE,
		clearable: false
	},
	negative_cache_ttl: {
		label: 'Negative cache TTL (seconds)',
		description: 'How long to cache negative answers, such as NXDOMAIN.',
		...TTL_RANGE,
		clearable: true
	},
	ratelimit: {
		label: 'Rate limit (queries per second)',
		description: 'The most DNS queries per second forwarded to the upstream servers.',
		min: 100,
		max: 1_000_000_000,
		step: 100,
		clearable: true
	},
	retries: {
		label: 'Retries',
		description: 'Extra attempts when fetching an answer from the upstream servers.',
		min: 0,
		max: 2,
		clearable: false
	}
}

const NUMBER_GROUPS = [
	{ legend: 'Caching', keys: ['minimum_cache_ttl', 'maximum_cache_ttl', 'negative_cache_ttl'] },
	{ legend: 'Upstream queries', keys: ['ratelimit', 'retries'] }
]

// A new cluster is created with the switches exactly as shown; empty numbers are left out
// so Cloudflare applies its defaults.
const defaultForm = () => ({
	name: '',
	upstream_ips: [],
	minimum_cache_ttl: null,
	maximum_cache_ttl: null,
	negative_cache_ttl: null,
	ratelimit: null,
	retries: null,
	ecs_fallback: false,
	deprecate_any_requests: true,
	attack_mitigation_enabled: false,
	attack_mitigation_unhealthy_only: false
})

const ADVANCED_FIELDS = Object.keys(NUMBER_FIELDS)
const SWITCH_FIELDS = ['ecs_fallback', 'deprecate_any_requests']
// Set by Cloudflare, so never sent back in a create or update.
const READ_ONLY_FIELDS = ['id', 'dns_firewall_ips', 'modified_on']
const IPS_SHOWN = 4
// Pasted lists are often separated by spaces or new lines rather than commas.
const IP_DELIMITER = /[\s,;]+/

const IP_COLUMNS = [
	{
		key: 'dns_firewall_ips',
		slot: 'dns_firewall_ips-cell',
		label: 'DNS Firewall IPs',
		empty: 'None assigned',
		copy: true
	},
	{ key: 'upstream_ips', slot: 'upstream_ips-cell', label: 'upstream IPs', empty: 'None', copy: false }
]

const route = useRoute()
const notify = useNotify()
const { formatTtl } = useRecordTypes()

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
	items: clusterList,
	loading: listLoading,
	loaded: listLoaded,
	error: listError,
	resultInfo,
	truncated,
	load: loadClusters,
	refresh: refreshList,
	create: createCluster,
	update: updateCluster,
	remove: removeCluster
} = useAccountResource(zoneId, {
	list: 'dns_firewall_clusters',
	item: 'dns_firewall_cluster',
	payloadKey: 'cluster',
	idParam: 'clusterId',
	label: 'DNS Firewall cluster',
	perPage: 100
})

const accountName = computed(() => zone.value?.account?.name || '')
const canUse = computed(() => can('dnsFirewall'))
const accessReason = computed(() => missingCapabilities.value.find((item) => item.key === 'dnsFirewall')?.reason || '')

useSeoMeta({
	title: computed(() => (accountName.value ? `DNS Firewall · ${accountName.value}` : 'DNS Firewall'))
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
		if (id && available) loadClusters()
	},
	{ immediate: true }
)

// --- List --------------------------------------------------------------------------------

const sortedClusters = computed(() =>
	[...clusterList.value].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
)

const FROM_SM = { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' }
const FROM_MD = { th: 'hidden md:table-cell', td: 'hidden md:table-cell' }

const columns = [
	{ accessorKey: 'name', header: 'Name' },
	{ accessorKey: 'dns_firewall_ips', header: 'DNS Firewall IPs', meta: { class: FROM_SM } },
	{ accessorKey: 'upstream_ips', header: 'Upstream IPs', meta: { class: FROM_MD } },
	{
		id: 'cache',
		header: 'Cache TTL',
		meta: { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' } }
	},
	{
		accessorKey: 'modified_on',
		header: 'Modified',
		meta: { class: { th: 'hidden xl:table-cell', td: 'hidden xl:table-cell' } }
	},
	{
		id: 'actions',
		header: () => h('span', { class: 'sr-only' }, 'Actions'),
		meta: { class: { td: 'w-px text-end' } }
	}
]

const expandedIps = ref(new Set())
const expandKey = (cluster, key) => `${cluster.id}:${key}`
const isExpanded = (cluster, key) => expandedIps.value.has(expandKey(cluster, key))

const toggleIps = (cluster, key) => {
	const id = expandKey(cluster, key)
	if (expandedIps.value.has(id)) expandedIps.value.delete(id)
	else expandedIps.value.add(id)
}

const visibleIps = (cluster, key) => {
	const ips = cluster[key] || []
	return isExpanded(cluster, key) ? ips : ips.slice(0, IPS_SHOWN)
}

const ipSummary = (ips = []) => {
	if (!ips?.length) return 'none'
	return ips.length > 1 ? `${ips[0]} +${ips.length - 1}` : ips[0]
}

// One address per line, ready to paste into a registrar's name server form.
const copyFirewallIps = (cluster) => notify.copy((cluster?.dns_firewall_ips || []).join('\n'), 'DNS Firewall IPs')

const cacheRange = (cluster) => {
	const min = formatTtl(cluster.minimum_cache_ttl)
	const max = formatTtl(cluster.maximum_cache_ttl)
	if (!min && !max) return 'Not set'
	return `${min || 'not set'} to ${max || 'not set'}`
}

const rowActions = (cluster) => [
	[
		{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEdit(cluster) },
		{
			label: 'Copy DNS Firewall IPs',
			icon: 'i-lucide-copy',
			disabled: !cluster.dns_firewall_ips?.length,
			onSelect: () => copyFirewallIps(cluster)
		}
	],
	[{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => askDelete(cluster) }]
]

// --- Create and edit ---------------------------------------------------------------------

const panelOpen = ref(false)
// The cluster being edited, as Cloudflare returned it; null while creating.
const editing = ref(null)
const justCreated = ref(false)
const form = reactive(defaultForm())
// Fields that came from the cluster or the JSON editor but have no control in the form.
const extraFields = ref({})
const fieldErrors = reactive({})
const saveError = ref('')
const saving = ref(false)
const advancedOpen = ref(false)
// Edits in "Edit as JSON" that haven't been applied or discarded. Saving would leave them
// out without a word, so submit stops and asks for them to be applied or discarded first.
const jsonDirty = ref(false)
const JSON_UNAPPLIED = 'Apply them to the form or discard them, then save again.'

const onJsonDirty = (dirty) => {
	jsonDirty.value = dirty
	if (!dirty && saveError.value === JSON_UNAPPLIED) saveError.value = ''
}

const fieldsRoot = useTemplateRef('fieldsRoot')

const resetErrors = () => {
	for (const key of Object.keys(fieldErrors)) fieldErrors[key] = ''
	saveError.value = ''
}

const toNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

// Splits a cluster-shaped object into form values and the fields the form doesn't show.
const splitCluster = (source) => {
	const values = defaultForm()
	const rest = {}
	for (const [key, value] of Object.entries(source || {})) {
		if (READ_ONLY_FIELDS.includes(key) || value === undefined) continue
		if (key === 'attack_mitigation') {
			values.attack_mitigation_enabled = value?.enabled === true
			values.attack_mitigation_unhealthy_only = value?.only_when_upstream_unhealthy === true
		} else if (key in NUMBER_FIELDS) {
			values[key] = value === null || value === '' ? null : toNumber(Number(value))
		} else if (SWITCH_FIELDS.includes(key)) {
			values[key] = value === true
		} else if (key === 'name' || key === 'upstream_ips') {
			values[key] = value
		} else {
			rest[key] = value
		}
	}
	values.name = typeof values.name === 'string' ? values.name : ''
	values.upstream_ips = Array.isArray(values.upstream_ips) ? values.upstream_ips.map(String) : []
	return { values, rest }
}

// The cluster the form describes, in Cloudflare's shape. Empty numbers are null.
const toCluster = (values) => ({
	name: values.name.trim(),
	upstream_ips: [...values.upstream_ips],
	...Object.fromEntries(ADVANCED_FIELDS.map((key) => [key, toNumber(values[key])])),
	ecs_fallback: values.ecs_fallback,
	deprecate_any_requests: values.deprecate_any_requests,
	attack_mitigation: {
		enabled: values.attack_mitigation_enabled,
		only_when_upstream_unhealthy: values.attack_mitigation_unhealthy_only
	}
})

const desired = computed(() => ({ ...extraFields.value, ...toCluster(form) }))

// The stored cluster read through the same mapping, so untouched fields compare equal.
const baseline = computed(() => {
	if (!editing.value) return null
	const { values, rest } = splitCluster(editing.value)
	return { ...rest, ...toCluster(values) }
})

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const createPayload = () =>
	Object.fromEntries(
		Object.entries(desired.value).filter(([key, value]) => !(key in NUMBER_FIELDS && value === null))
	)

// Cloudflare's update is a PATCH, so only fields that differ from the stored cluster are sent.
const changedFields = () =>
	Object.fromEntries(Object.entries(desired.value).filter(([key, value]) => !sameValue(value, baseline.value[key])))

const openCreate = () => {
	editing.value = null
	justCreated.value = false
	Object.assign(form, defaultForm())
	extraFields.value = {}
	advancedOpen.value = false
	jsonDirty.value = false
	resetErrors()
	panelOpen.value = true
}

const showCluster = (cluster) => {
	const { values, rest } = splitCluster(cluster)
	editing.value = cluster
	Object.assign(form, values)
	extraFields.value = rest
	resetErrors()
}

const openEdit = (cluster) => {
	showCluster(cluster)
	justCreated.value = false
	advancedOpen.value = false
	jsonDirty.value = false
	panelOpen.value = true
}

const applyJson = (parsed) => {
	const { values, rest } = splitCluster(parsed)
	Object.assign(form, values)
	extraFields.value = rest
	resetErrors()
}

// Accept addresses pasted with brackets, as in [2001:db8::1].
const cleanIp = (value) =>
	String(value)
		.trim()
		.replace(/^\[(.*)\]$/, '$1')

const setUpstreamIps = (values) => {
	form.upstream_ips = [...new Set((values || []).map(cleanIp).filter(Boolean))]
}

const formatRange = ({ min, max }) => `${min.toLocaleString()} to ${max.toLocaleString()}`

const numberDescription = (key) => {
	const field = NUMBER_FIELDS[key]
	let hint = ''
	if (!editing.value) hint = ' Leave empty to use Cloudflare’s default.'
	else if (field.clearable) hint = ' Leave empty to clear it.'
	return `${field.description} ${formatRange(field)}.${hint}`
}

const validate = () => {
	resetErrors()
	const name = form.name.trim()
	if (!name) fieldErrors.name = 'Enter a name so you can tell this cluster apart from others'
	else if (name.length > 160) fieldErrors.name = 'Use 160 characters or fewer'

	const invalidIp = form.upstream_ips.find((ip) => !isIp(ip))
	if (!form.upstream_ips.length)
		fieldErrors.upstream_ips = 'Add at least one upstream name server IP, such as 192.0.2.53'
	else if (invalidIp !== undefined) fieldErrors.upstream_ips = `“${invalidIp}” isn’t an IPv4 or IPv6 address`

	for (const [key, field] of Object.entries(NUMBER_FIELDS)) {
		const value = toNumber(form[key])
		if (value === null) {
			if (editing.value && !field.clearable && baseline.value?.[key] !== null) {
				fieldErrors[key] =
					`Cloudflare can’t clear this setting. Enter a whole number from ${formatRange(field)}`
			}
		} else if (!Number.isInteger(value) || value < field.min || value > field.max) {
			fieldErrors[key] = `Enter a whole number from ${formatRange(field)}`
		}
	}

	const min = toNumber(form.minimum_cache_ttl)
	const max = toNumber(form.maximum_cache_ttl)
	if (min !== null && max !== null && min > max && !fieldErrors.maximum_cache_ttl) {
		fieldErrors.maximum_cache_ttl = `Make this at least the minimum cache TTL (${min.toLocaleString()} seconds)`
	}

	const valid = !Object.values(fieldErrors).some(Boolean)
	if (!valid && ADVANCED_FIELDS.some((key) => fieldErrors[key])) advancedOpen.value = true
	return valid
}

const focusFirstError = async () => {
	await nextTick()
	const invalid = fieldsRoot.value?.querySelector('[aria-invalid="true"]')
	const target = invalid?.matches('input, textarea') ? invalid : invalid?.querySelector('input, textarea')
	target?.focus()
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

	if (editing.value) {
		const changes = changedFields()
		if (!Object.keys(changes).length) {
			notify.success('No changes to save', editing.value.name)
			panelOpen.value = false
			return
		}

		saving.value = true
		try {
			const result = await updateCluster(editing.value.id, changes)
			notify.success('Cluster saved', result?.name || form.name.trim())
			panelOpen.value = false
		} catch (error) {
			saveError.value = describeError(error, 'Couldn’t save the cluster')
		} finally {
			saving.value = false
		}
		return
	}

	saving.value = true
	try {
		const result = await createCluster(createPayload())
		notify.success('Cluster created', result?.name || form.name.trim())
		// Keep the panel open on the new cluster so its assigned IPs can be copied straight away.
		if (result?.id) {
			showCluster(result)
			justCreated.value = true
			advancedOpen.value = false
		} else {
			panelOpen.value = false
		}
	} catch (error) {
		saveError.value = describeError(error, 'Couldn’t create the cluster')
	} finally {
		saving.value = false
	}
}

const onPanelClosed = () => {
	editing.value = null
	justCreated.value = false
	extraFields.value = {}
	jsonDirty.value = false
	resetErrors()
}

// --- Delete ------------------------------------------------------------------------------

const deleteOpen = ref(false)
const deleteTarget = ref(null)

const askDelete = (cluster) => {
	deleteTarget.value = cluster
	deleteOpen.value = true
}

const deleteCluster = async () => {
	const cluster = deleteTarget.value
	if (!cluster) return
	await removeCluster(cluster.id)
	notify.success('Cluster deleted', cluster.name)
	if (editing.value?.id === cluster.id) panelOpen.value = false
}

// Panels opened for one zone's account shouldn't stay open after switching zones.
watch(zoneId, () => {
	panelOpen.value = false
	deleteOpen.value = false
})
</script>
