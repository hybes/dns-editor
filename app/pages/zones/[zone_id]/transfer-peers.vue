<template>
	<UDashboardPanel id="transfer-peers">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span>Transfer peers</span>
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
						aria-label="Refresh peers, TSIG keys and ACLs"
						:loading="anyLoading"
						@click="refreshAll"
					/>
					<UButton
						v-if="canUse"
						icon="i-lucide-plus"
						:label="KINDS[tab].createLabel"
						@click="openCreate(tab)"
					/>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<AccountFeatureGate
				:loaded="capabilitiesLoaded"
				:available="canUse"
				feature="zone transfers"
				:reason="accessReason"
				hint="Zone transfers need Secondary DNS, which Cloudflare offers on Enterprise plans. The token needs Account Settings access for this account, with Edit to make changes."
				:checking="zoneLoading"
				@retry="refreshZone"
			>
				<p class="text-muted text-sm">
					Peers, TSIG keys and ACLs belong to
					{{ accountName ? `the ${accountName} account` : 'the zone’s Cloudflare account' }}, not to
					{{ zoneName || 'this zone' }}, and are used by the zone transfer settings of every zone in it. Link
					them to a zone on its
					<ULink
						raw
						:to="`/zones/${zoneId}/zone-transfers`"
						class="text-primary focus-visible:outline-primary rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
						>Zone transfers</ULink
					>
					page.
				</p>

				<UTabs v-model="tab" :items="tabItems" variant="link" class="w-full" :ui="{ content: 'pt-4' }">
					<template v-for="kind in KIND_KEYS" #[kind] :key="kind">
						<div class="flex min-w-0 flex-col gap-4">
							<p class="text-muted text-sm">{{ KINDS[kind].summary }}</p>

							<UAlert
								v-if="resources[kind].truncated"
								color="warning"
								variant="subtle"
								icon="i-lucide-triangle-alert"
								:title="`Showing the first ${resources[kind].items.length} of ${resources[kind].resultInfo?.total_count} ${KINDS[kind].plural}`"
								description="Cloudflare returned one page. Manage the rest in the Cloudflare dashboard."
							/>

							<AccountResourceTable
								:data="rows[kind]"
								:columns="COLUMNS[kind]"
								:loading="resources[kind].loading"
								:loaded="resources[kind].loaded"
								:error="resources[kind].error"
								:error-title="`Couldn’t load ${KINDS[kind].plural}`"
								:caption="capitalise(KINDS[kind].plural)"
								:loading-label="`Loading ${KINDS[kind].plural}…`"
								@retry="resources[kind].refresh()"
							>
								<template #empty>
									<UEmpty
										variant="naked"
										:icon="KINDS[kind].icon"
										:title="`No ${KINDS[kind].plural} in this account`"
										:description="KINDS[kind].emptyDescription"
										:actions="[
											{
												label: KINDS[kind].createLabel,
												icon: 'i-lucide-plus',
												onClick: () => openCreate(kind)
											}
										]"
									/>
								</template>

								<template #name-cell="{ row }">
									<div class="flex max-w-[55vw] min-w-0 flex-col gap-0.5 sm:max-w-64">
										<button
											type="button"
											class="text-highlighted focus-visible:outline-primary truncate rounded-sm text-start font-medium hover:underline focus-visible:outline-2"
											@click="openEdit(kind, row.original)"
										>
											{{ row.original.name || row.original.id }}
										</button>
										<template v-if="kind === 'peers'">
											<span class="text-muted truncate font-mono text-xs sm:hidden">{{
												peerAddress(row.original)
											}}</span>
											<span class="text-muted truncate text-xs lg:hidden">
												{{ row.original.ixfr_enable ? 'IXFR' : 'AXFR' }} ·
												{{ tsigSummary(row.original.tsig_id) }}
											</span>
										</template>
										<span
											v-else-if="kind === 'tsigs'"
											class="text-muted truncate text-xs sm:hidden"
										>
											{{ algorithmLabel(row.original.algo) }}
										</span>
										<span v-else class="text-muted truncate font-mono text-xs sm:hidden">{{
											row.original.ip_range
										}}</span>
									</div>
								</template>

								<template #address-cell="{ row }">
									<code v-if="row.original.ip" class="text-default font-mono text-xs">{{
										peerAddress(row.original)
									}}</code>
									<span v-else class="text-dimmed">No IP address</span>
								</template>

								<template #tsig-cell="{ row }">
									<span v-if="!row.original.tsig_id" class="text-dimmed">None</span>
									<span v-else-if="tsigById.get(row.original.tsig_id)" class="text-default">{{
										tsigById.get(row.original.tsig_id).name
									}}</span>
									<span v-else class="text-muted" :title="row.original.tsig_id">Key not found</span>
								</template>

								<template #transfer-cell="{ row }">
									{{ row.original.ixfr_enable ? 'Incremental (IXFR)' : 'Full (AXFR)' }}
								</template>

								<template #algo-cell="{ row }">
									{{ algorithmLabel(row.original.algo) }}
								</template>

								<template #secret-cell="{ row }">
									<div v-if="row.original.secret" class="flex max-w-72 min-w-0 items-center gap-1">
										<code
											class="min-w-0 font-mono text-xs"
											:class="
												revealed.has(row.original.id) ? 'text-default break-all' : 'text-muted'
											"
											>{{
												revealed.has(row.original.id) ? row.original.secret : SECRET_MASK
											}}</code
										>
										<UButton
											:icon="revealed.has(row.original.id) ? 'i-lucide-eye-off' : 'i-lucide-eye'"
											size="xs"
											color="neutral"
											variant="ghost"
											:aria-label="`${revealed.has(row.original.id) ? 'Hide' : 'Show'} secret for ${row.original.name}`"
											:aria-pressed="revealed.has(row.original.id)"
											@click="toggleSecret(row.original.id)"
										/>
										<UButton
											icon="i-lucide-copy"
											size="xs"
											color="neutral"
											variant="ghost"
											:aria-label="`Copy secret for ${row.original.name}`"
											@click="notify.copy(row.original.secret, 'Secret')"
										/>
									</div>
									<span v-else class="text-dimmed">Not returned</span>
								</template>

								<template #usage-cell="{ row }">
									<span v-if="peersUsing(row.original.id).length" class="text-default">
										{{ plural(peersUsing(row.original.id).length, 'peer') }}
									</span>
									<span v-else class="text-dimmed">No peers</span>
								</template>

								<template #ip_range-cell="{ row }">
									<div class="flex items-center gap-1">
										<code class="text-default font-mono text-xs">{{ row.original.ip_range }}</code>
										<UButton
											icon="i-lucide-copy"
											size="xs"
											color="neutral"
											variant="ghost"
											:aria-label="`Copy IP range for ${row.original.name}`"
											@click="notify.copy(row.original.ip_range, 'IP range')"
										/>
									</div>
								</template>

								<template #actions-cell="{ row }">
									<div class="flex justify-end">
										<UDropdownMenu
											:items="rowActions(kind, row.original)"
											:content="{ align: 'end' }"
										>
											<UButton
												icon="i-lucide-ellipsis-vertical"
												color="neutral"
												variant="ghost"
												:aria-label="`Actions for ${row.original.name || row.original.id}`"
											/>
										</UDropdownMenu>
									</div>
								</template>
							</AccountResourceTable>
						</div>
					</template>
				</UTabs>
			</AccountFeatureGate>

			<AccountFormSlideover
				v-model:open="panelOpen"
				:title="editing ? `Edit ${editing.name || KINDS[panelKind].noun}` : KINDS[panelKind].createTitle"
				:description="
					editing
						? `Saving replaces every setting on the ${KINDS[panelKind].noun} with the values below.`
						: ''
				"
				:submit-label="editing ? KINDS[panelKind].saveLabel : KINDS[panelKind].createLabel"
				:saving="saving"
				:error="saveError"
				:error-title="
					saveError === JSON_UNAPPLIED
						? 'Your JSON edits haven’t been applied'
						: editing
							? `Cloudflare didn’t save the ${KINDS[panelKind].noun}`
							: `Cloudflare didn’t create the ${KINDS[panelKind].noun}`
				"
				@submit="submit"
				@after:leave="onPanelClosed"
			>
				<div ref="fieldsRoot" class="flex flex-col gap-5">
					<dl v-if="editing" class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
						<dt class="text-muted">{{ KINDS[panelKind].idLabel }}</dt>
						<dd class="flex min-w-0 items-center gap-1">
							<code class="text-default truncate font-mono text-xs">{{ editing.id }}</code>
							<UButton
								icon="i-lucide-copy"
								size="xs"
								color="neutral"
								variant="ghost"
								:aria-label="`Copy ${KINDS[panelKind].idNoun} for ${editing.name}`"
								@click="notify.copy(editing.id, KINDS[panelKind].idLabel)"
							/>
						</dd>
						<template v-if="panelKind === 'tsigs'">
							<dt class="text-muted">Used by</dt>
							<dd class="text-default min-w-0">
								{{ peerNames(peersUsing(editing.id)) || 'No peers' }}
							</dd>
						</template>
					</dl>

					<UFormField
						:label="panelKind === 'tsigs' ? 'Key name' : 'Name'"
						required
						:description="nameDescription"
						:error="fieldErrors.name || false"
					>
						<UInput
							v-model="form.name"
							:placeholder="KINDS[panelKind].namePlaceholder"
							autocomplete="off"
							spellcheck="false"
							class="w-full"
							:ui="panelKind === 'tsigs' ? { base: 'font-mono' } : undefined"
						/>
					</UFormField>

					<template v-if="panelKind === 'peers'">
						<UFormField
							label="IP address"
							description="For zones where Cloudflare is secondary, the primary name server Cloudflare transfers from. For zones where Cloudflare is primary, the secondary it sends a NOTIFY to."
							:error="fieldErrors.ip || false"
						>
							<UInput
								v-model="form.ip"
								placeholder="192.0.2.53"
								autocomplete="off"
								spellcheck="false"
								class="w-full"
								:ui="{ base: 'font-mono' }"
							/>
						</UFormField>

						<UFormField
							label="Port"
							description="The DNS port on that name server, usually 53."
							:error="fieldErrors.port || false"
						>
							<UInputNumber
								v-model="form.port"
								:min="1"
								:max="65535"
								:step-snapping="false"
								:format-options="{ useGrouping: false }"
								placeholder="53"
								class="w-full"
							/>
						</UFormField>

						<UAlert
							v-if="resources.tsigs.error"
							color="warning"
							variant="subtle"
							icon="i-lucide-triangle-alert"
							title="Couldn’t load this account’s TSIG keys"
							:description="`${resources.tsigs.error} The peer’s current key is kept.`"
							:actions="[
								{
									label: 'Try again',
									icon: 'i-lucide-refresh-cw',
									color: 'neutral',
									variant: 'outline',
									loading: resources.tsigs.loading,
									onClick: () => resources.tsigs.refresh()
								}
							]"
						/>

						<UFormField
							label="TSIG key"
							description="Signs transfers with this peer. Choose the key your other DNS provider uses for it."
							:error="fieldErrors.tsig_id || false"
						>
							<USelect
								v-model="form.tsig_id"
								:items="tsigOptions"
								:loading="resources.tsigs.loading"
								class="w-full"
							/>
						</UFormField>

						<USwitch
							v-model="form.ixfr_enable"
							label="Incremental transfers (IXFR)"
							description="Ask this peer for only what changed instead of the whole zone (AXFR). Only used when Cloudflare is the secondary."
						/>
					</template>

					<template v-else-if="panelKind === 'tsigs'">
						<UFormField
							label="Algorithm"
							required
							description="Must match the algorithm set for this key at your other DNS provider."
							:error="fieldErrors.algo || false"
						>
							<USelectMenu
								v-model="form.algo"
								:items="algorithmOptions"
								value-key="value"
								label-key="label"
								:filter-fields="['label', 'value']"
								:create-item="{ when: 'empty' }"
								:search-input="{ placeholder: 'Search, or type another algorithm' }"
								class="w-full"
								@create="setAlgorithm"
							>
								<template #create-item-label="{ item }">Use “{{ item }}”</template>
							</USelectMenu>
						</UFormField>

						<UFormField
							label="Secret"
							required
							:description="
								editing
									? 'Base64. Changing it stops transfers signed with this key until your other DNS provider uses the new secret.'
									: 'The base64 secret shared with your other DNS provider. Paste theirs, or generate one here and give it to them.'
							"
							:error="fieldErrors.secret || false"
						>
							<div class="flex gap-2">
								<UInput
									v-model="form.secret"
									:type="secretShown ? 'text' : 'password'"
									autocomplete="off"
									spellcheck="false"
									autocapitalize="off"
									class="min-w-0 flex-1"
									:ui="{ base: 'font-mono', trailing: 'pe-1' }"
								>
									<template #trailing>
										<UButton
											:icon="secretShown ? 'i-lucide-eye-off' : 'i-lucide-eye'"
											size="sm"
											color="neutral"
											variant="link"
											:aria-label="secretShown ? 'Hide secret' : 'Show secret'"
											:aria-pressed="secretShown"
											@click="secretShown = !secretShown"
										/>
									</template>
								</UInput>
								<UButton
									label="Generate"
									icon="i-lucide-dices"
									color="neutral"
									variant="outline"
									@click="generateSecret"
								/>
								<UButton
									icon="i-lucide-copy"
									color="neutral"
									variant="outline"
									aria-label="Copy secret"
									:disabled="!form.secret"
									@click="notify.copy(form.secret, 'Secret')"
								/>
							</div>
						</UFormField>
					</template>

					<UFormField
						v-else
						label="IP range"
						required
						description="In CIDR form, such as 192.0.2.0/24. Cloudflare accepts IPv4 ranges from /24 to /32 and IPv6 ranges from /64 to /128."
						:error="fieldErrors.ip_range || false"
					>
						<UInput
							v-model="form.ip_range"
							placeholder="192.0.2.0/24"
							autocomplete="off"
							spellcheck="false"
							class="w-full"
							:ui="{ base: 'font-mono' }"
						/>
					</UFormField>

					<AccountJsonPanel
						v-if="panelKind !== 'tsigs'"
						:value="desired"
						label="Edit as JSON"
						editable
						apply-label="Apply to form"
						help="Applying replaces the form with this JSON. Fields the form doesn’t show are sent as they are."
						@apply="applyJson"
						@dirty="onJsonDirty"
					/>
				</div>
			</AccountFormSlideover>

			<AccountDeleteModal
				v-model:open="deleteOpen"
				:title="
					deleteTarget
						? `Delete ‘${deleteTarget.name || deleteTarget.id}’?`
						: `Delete ${KINDS[deleteKind].noun}?`
				"
				:description="deleteDescription"
				:confirm-label="KINDS[deleteKind].deleteLabel"
				:action="deleteItem"
			>
				<template v-if="deleteKind === 'tsigs' && deleteTarget && peersUsing(deleteTarget.id).length">
					<p class="text-muted">Peers using this key:</p>
					<ul class="mt-1 flex flex-col gap-0.5">
						<li v-for="peer in peersUsing(deleteTarget.id)" :key="peer.id">{{ peer.name || peer.id }}</li>
					</ul>
				</template>
			</AccountDeleteModal>
		</template>
	</UDashboardPanel>
</template>

<script setup>
const KINDS = {
	peers: {
		noun: 'peer',
		plural: 'peers',
		tab: 'Peers',
		icon: 'i-lucide-server',
		createLabel: 'Create peer',
		createTitle: 'Create a peer',
		saveLabel: 'Save peer',
		deleteLabel: 'Delete peer',
		idLabel: 'Peer ID',
		idNoun: 'peer ID',
		namePlaceholder: 'ns1 at example-dns',
		summary:
			'Name servers at your other DNS providers: the primaries Cloudflare transfers secondary zones from, and the secondaries it notifies when a primary zone changes.',
		emptyDescription: 'Create a peer for each name server that sends zones to Cloudflare or copies them from it.'
	},
	tsigs: {
		noun: 'TSIG key',
		plural: 'TSIG keys',
		tab: 'TSIG keys',
		icon: 'i-lucide-key-round',
		createLabel: 'Create TSIG key',
		createTitle: 'Create a TSIG key',
		saveLabel: 'Save TSIG key',
		deleteLabel: 'Delete TSIG key',
		idLabel: 'Key ID',
		idNoun: 'key ID',
		namePlaceholder: 'transfer.example.com.',
		summary:
			'Shared secrets that sign zone transfers between Cloudflare and a peer. The key name, algorithm and secret must match exactly at the other provider.',
		emptyDescription: 'Create a TSIG key to sign zone transfers with a secret shared with your other DNS provider.'
	},
	acls: {
		noun: 'ACL',
		plural: 'ACLs',
		tab: 'ACLs',
		icon: 'i-lucide-list-checks',
		createLabel: 'Create ACL',
		createTitle: 'Create an ACL',
		saveLabel: 'Save ACL',
		deleteLabel: 'Delete ACL',
		idLabel: 'ACL ID',
		idNoun: 'ACL ID',
		namePlaceholder: 'Secondary name servers',
		summary:
			'IP ranges Cloudflare accepts NOTIFY messages from for secondary zones, and lets transfer zones where Cloudflare is primary.',
		emptyDescription:
			'Create an ACL for the addresses of your other name servers, so Cloudflare accepts their NOTIFY messages and transfer requests.'
	}
}
const KIND_KEYS = Object.keys(KINDS)

// Cloudflare documents only “TSIG algorithm” with hmac-sha512. as its example; these are the
// usual choices, and any other name can be typed in.
const ALGORITHMS = [
	{ value: 'hmac-sha512.', label: 'HMAC-SHA512' },
	{ value: 'hmac-sha256.', label: 'HMAC-SHA256' }
]
const DEFAULT_ALGORITHM = ALGORITHMS[0].value
// USelect can’t hold an empty value, so “no key” has a value of its own.
const NO_TSIG = 'none'
const SECRET_MASK = '••••••••••••••••'
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

// The fields each kind has a control for. Anything else Cloudflare returns is kept and sent
// back, because updates are PUTs that replace the whole item.
const FORM_FIELDS = {
	peers: ['name', 'ip', 'port', 'ixfr_enable', 'tsig_id'],
	tsigs: ['name', 'algo', 'secret'],
	acls: ['name', 'ip_range']
}

const FROM_SM = { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' }
const FROM_MD = { th: 'hidden md:table-cell', td: 'hidden md:table-cell' }
const FROM_LG = { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' }
const ACTIONS_COLUMN = {
	id: 'actions',
	header: () => h('span', { class: 'sr-only' }, 'Actions'),
	meta: { class: { td: 'w-px text-end' } }
}

const COLUMNS = {
	peers: [
		{ accessorKey: 'name', header: 'Name' },
		{ id: 'address', header: 'Address', meta: { class: FROM_SM } },
		{ id: 'tsig', header: 'TSIG key', meta: { class: FROM_MD } },
		{ id: 'transfer', header: 'Transfers', meta: { class: FROM_LG } },
		ACTIONS_COLUMN
	],
	tsigs: [
		{ accessorKey: 'name', header: 'Key name' },
		{ accessorKey: 'algo', header: 'Algorithm', meta: { class: FROM_SM } },
		{ id: 'secret', header: 'Secret', meta: { class: FROM_MD } },
		{ id: 'usage', header: 'Used by', meta: { class: FROM_LG } },
		ACTIONS_COLUMN
	],
	acls: [
		{ accessorKey: 'name', header: 'Name' },
		{ accessorKey: 'ip_range', header: 'IP range', meta: { class: FROM_SM } },
		ACTIONS_COLUMN
	]
}

const route = useRoute()
const router = useRouter()
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

const commandsFor = (group) => ({
	list: `dns zone-transfers ${group} list`,
	create: `dns zone-transfers ${group} create`,
	update: `dns zone-transfers ${group} update`,
	delete: `dns zone-transfers ${group} delete`
})

// reactive() unwraps each resource's refs, so the template and script read them the same way.
const resources = {
	peers: reactive(useAccountResource(zoneId, { commands: commandsFor('peers'), idArg: 'peer-id', label: 'peer' })),
	tsigs: reactive(
		useAccountResource(zoneId, { commands: commandsFor('tsigs'), idArg: 'tsig-id', label: 'TSIG key' })
	),
	acls: reactive(useAccountResource(zoneId, { commands: commandsFor('acls'), idArg: 'acl-id', label: 'ACL' }))
}

const accountName = computed(() => zone.value?.account?.name || '')
const canUse = computed(() => can('zoneTransfers'))
const accessReason = computed(
	() => missingCapabilities.value.find((item) => item.key === 'zoneTransfers')?.reason || ''
)

useSeoMeta({
	title: computed(() => (accountName.value ? `Transfer peers · ${accountName.value}` : 'Transfer peers'))
})

// --- Tabs --------------------------------------------------------------------------------

// Kept in the URL so a refresh or a shared link opens the same list.
const tab = computed({
	get: () => (KIND_KEYS.includes(route.query.tab) ? route.query.tab : 'peers'),
	set: (value) => router.replace({ query: { ...route.query, tab: value === 'peers' ? undefined : value } })
})

const tabItems = computed(() =>
	KIND_KEYS.map((kind) => ({
		value: kind,
		slot: kind,
		label: KINDS[kind].tab,
		badge: resources[kind].loaded
			? { label: String(resources[kind].items.length), color: 'neutral', variant: 'subtle', size: 'sm' }
			: undefined
	}))
)

const anyLoading = computed(() => KIND_KEYS.some((kind) => resources[kind].loading))

const loadAll = () => {
	for (const kind of KIND_KEYS) resources[kind].load()
}

const refreshAll = () => {
	for (const kind of KIND_KEYS) resources[kind].refresh()
}

// --- Lists -------------------------------------------------------------------------------

const byName = (items) => [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))

const rows = computed(() => ({
	peers: byName(resources.peers.items),
	tsigs: byName(resources.tsigs.items),
	acls: byName(resources.acls.items)
}))

const tsigById = computed(() => new Map(resources.tsigs.items.map((key) => [key.id, key])))

const peersUsing = (tsigId) => rows.value.peers.filter((peer) => tsigId && peer.tsig_id === tsigId)
const peerNames = (peers) => peers.map((peer) => peer.name || peer.id).join(', ')

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1)

const peerAddress = (peer) => {
	if (!peer?.ip) return 'No IP address'
	if (!peer.port) return peer.ip
	return peer.ip.includes(':') ? `[${peer.ip}]:${peer.port}` : `${peer.ip}:${peer.port}`
}

const tsigSummary = (tsigId) => {
	if (!tsigId) return 'No TSIG'
	const key = tsigById.value.get(tsigId)
	return key ? `TSIG ${key.name}` : 'TSIG key not found'
}

const algorithmLabel = (value) =>
	ALGORITHMS.find((item) => item.value === value)?.label || String(value || '') || 'Unknown'

const revealed = ref(new Set())

const toggleSecret = (id) => {
	const next = new Set(revealed.value)
	if (next.has(id)) next.delete(id)
	else next.add(id)
	revealed.value = next
}

const rowActions = (kind, item) => {
	const actions = [{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEdit(kind, item) }]
	if (kind === 'tsigs') {
		actions.push({
			label: 'Copy secret',
			icon: 'i-lucide-copy',
			disabled: !item.secret,
			onSelect: () => notify.copy(item.secret, 'Secret')
		})
	}
	if (kind === 'acls') {
		actions.push({
			label: 'Copy IP range',
			icon: 'i-lucide-copy',
			onSelect: () => notify.copy(item.ip_range, 'IP range')
		})
	}
	actions.push({
		label: `Copy ${KINDS[kind].idNoun}`,
		icon: 'i-lucide-copy',
		onSelect: () => notify.copy(item.id, KINDS[kind].idLabel)
	})
	return [
		actions,
		[{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => askDelete(kind, item) }]
	]
}

// --- Create and edit ---------------------------------------------------------------------

const defaultForm = (kind) => {
	if (kind === 'peers') return { name: '', ip: '', port: 53, ixfr_enable: false, tsig_id: NO_TSIG }
	if (kind === 'tsigs') return { name: '', algo: DEFAULT_ALGORITHM, secret: '' }
	return { name: '', ip_range: '' }
}

const panelOpen = ref(false)
const panelKind = ref('peers')
// The item being edited, as Cloudflare returned it; null while creating.
const editing = ref(null)
const form = ref(defaultForm('peers'))
// Fields that came from the item or the JSON editor but have no control in the form.
const extraFields = ref({})
const fieldErrors = reactive({})
const saveError = ref('')
const saving = ref(false)
const secretShown = ref(false)
// Algorithms typed in that aren't in ALGORITHMS, so the menu can show them.
const customAlgorithms = ref([])
const fieldsRoot = useTemplateRef('fieldsRoot')
// Edits in "Edit as JSON" that haven't been applied or discarded. Saving would leave them
// out without a word, so submit stops and asks for them to be applied or discarded first.
const jsonDirty = ref(false)
const JSON_UNAPPLIED = 'Apply them to the form or discard them, then save again.'

const onJsonDirty = (dirty) => {
	jsonDirty.value = dirty
	if (!dirty && saveError.value === JSON_UNAPPLIED) saveError.value = ''
}

const nameDescription = computed(() => {
	if (panelKind.value === 'tsigs') {
		return 'In domain name form, and exactly the same as the key name at your other DNS provider.'
	}
	return panelKind.value === 'peers'
		? 'A label to tell this name server apart when linking it to zones.'
		: 'A label to tell this range apart from others.'
})

const tsigOptions = computed(() => {
	const options = [
		{ value: NO_TSIG, label: 'No TSIG' },
		...byName(resources.tsigs.items).map((key) => ({
			value: key.id,
			label: key.name || key.id,
			description: algorithmLabel(key.algo)
		}))
	]
	const current = form.value.tsig_id
	if (current && current !== NO_TSIG && !tsigById.value.has(current)) {
		options.push({ value: current, label: `Key ${current}`, description: 'Not found in this account' })
	}
	return options
})

const algorithmOptions = computed(() => {
	const options = [...ALGORITHMS, ...customAlgorithms.value.map((value) => ({ value, label: value }))]
	const current = form.value.algo
	if (current && !options.some((item) => item.value === current)) options.push({ value: current, label: current })
	return options
})

const setAlgorithm = (term) => {
	const value = String(term || '').trim()
	if (!value) return
	if (!ALGORITHMS.some((item) => item.value === value) && !customAlgorithms.value.includes(value)) {
		customAlgorithms.value = [...customAlgorithms.value, value]
	}
	form.value.algo = value
}

// A random secret sized for the algorithm's hash: 64 bytes for SHA-512, 32 for SHA-256.
const secretBytes = (algorithm) => {
	const text = String(algorithm || '').toLowerCase()
	if (text.includes('md5')) return 16
	const bits = Number(text.match(/sha-?(\d+)/)?.[1])
	if (bits === 1) return 20
	return bits >= 224 && bits <= 512 ? bits / 8 : 32
}

const generateSecret = () => {
	const bytes = crypto.getRandomValues(new Uint8Array(secretBytes(form.value.algo)))
	form.value.secret = btoa(String.fromCharCode(...bytes))
	secretShown.value = true
	fieldErrors.secret = ''
}

const resetErrors = () => {
	for (const key of Object.keys(fieldErrors)) fieldErrors[key] = ''
	saveError.value = ''
}

const toNumber = (value) => {
	if (value === null || value === undefined || value === '') return null
	const number = Number(value)
	return Number.isFinite(number) ? number : null
}

// Splits an item-shaped object into form values and the fields the form doesn't show.
const splitItem = (kind, source) => {
	const values = defaultForm(kind)
	const rest = {}
	for (const [key, value] of Object.entries(source || {})) {
		if (key === 'id' || value === undefined) continue
		if (FORM_FIELDS[kind].includes(key)) values[key] = value
		else rest[key] = value
	}
	values.name = typeof values.name === 'string' ? values.name : ''
	if (kind === 'peers') {
		values.ip = typeof values.ip === 'string' ? values.ip : ''
		// A peer saved without a port keeps none, rather than picking up the create default.
		values.port = source && 'port' in source ? toNumber(source.port) : null
		values.ixfr_enable = values.ixfr_enable === true
		values.tsig_id = values.tsig_id ? String(values.tsig_id) : NO_TSIG
	} else if (kind === 'tsigs') {
		values.algo = typeof values.algo === 'string' && values.algo ? values.algo : DEFAULT_ALGORITHM
		values.secret = typeof values.secret === 'string' ? values.secret : ''
	} else {
		values.ip_range = typeof values.ip_range === 'string' ? values.ip_range : ''
	}
	return { values, rest }
}

// Accept addresses pasted with brackets, as in [2001:db8::1].
const cleanIp = (value) =>
	String(value || '')
		.trim()
		.replace(/^\[(.*)\]$/, '$1')

// The item the form describes, in Cloudflare's shape. Updates are PUTs, so this is the
// whole item; empty optional fields are left out.
const toItem = (kind, values, rest) => {
	const item = { ...rest, name: values.name.trim() }
	if (kind === 'peers') {
		const ip = cleanIp(values.ip)
		if (ip) item.ip = ip
		if (typeof values.port === 'number') item.port = values.port
		item.ixfr_enable = values.ixfr_enable === true
		if (values.tsig_id && values.tsig_id !== NO_TSIG) item.tsig_id = values.tsig_id
	} else if (kind === 'tsigs') {
		item.algo = values.algo.trim()
		item.secret = values.secret.trim()
	} else {
		item.ip_range = values.ip_range.trim()
	}
	return item
}

const desired = computed(() => toItem(panelKind.value, form.value, extraFields.value))

const baseline = computed(() => {
	if (!editing.value) return null
	const { values, rest } = splitItem(panelKind.value, editing.value)
	return toItem(panelKind.value, values, rest)
})

const openCreate = (kind) => {
	panelKind.value = kind
	editing.value = null
	form.value = defaultForm(kind)
	extraFields.value = {}
	secretShown.value = false
	jsonDirty.value = false
	resetErrors()
	panelOpen.value = true
}

const openEdit = (kind, item) => {
	const { values, rest } = splitItem(kind, item)
	panelKind.value = kind
	editing.value = item
	form.value = values
	extraFields.value = rest
	secretShown.value = false
	jsonDirty.value = false
	resetErrors()
	panelOpen.value = true
}

const applyJson = (parsed) => {
	const { values, rest } = splitItem(panelKind.value, parsed)
	form.value = values
	extraFields.value = rest
	resetErrors()
}

// CIDR with the prefix lengths Cloudflare allows: /24 to /32 for IPv4, /64 to /128 for IPv6.
const rangeError = (value) => {
	if (!value) return 'Enter an IP range, such as 192.0.2.0/24'
	const parts = value.split('/')
	const address = cleanIp(parts[0])
	if (parts.length === 1 && isIpv4(address))
		return `Add a prefix length, such as ${address}/32 for this address alone`
	if (parts.length === 1 && isIpv6(address))
		return `Add a prefix length, such as ${address}/128 for this address alone`
	if (parts.length !== 2 || !/^\d{1,3}$/.test(parts[1])) {
		return 'Enter the range in CIDR form, such as 192.0.2.0/24 or 2001:db8::/64'
	}
	const bits = Number(parts[1])
	if (isIpv4(address)) {
		if (bits > 32) return 'IPv4 prefixes go up to /32'
		if (bits < 24) return 'Cloudflare accepts IPv4 ranges up to /24. Use a prefix from /24 to /32'
		return ''
	}
	if (isIpv6(address)) {
		if (bits > 128) return 'IPv6 prefixes go up to /128'
		if (bits < 64) return 'Cloudflare accepts IPv6 ranges up to /64. Use a prefix from /64 to /128'
		return ''
	}
	return `“${address}” isn’t an IPv4 or IPv6 address`
}

const validate = () => {
	resetErrors()
	const kind = panelKind.value
	const values = form.value
	const name = values.name.trim()
	if (!name) fieldErrors.name = `Enter a name so you can tell this ${KINDS[kind].noun} apart from others`

	if (kind === 'peers') {
		const ip = cleanIp(values.ip)
		if (ip && !isIp(ip)) fieldErrors.ip = `“${ip}” isn’t an IPv4 or IPv6 address`
		const port = values.port
		if (port !== null && port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
			fieldErrors.port = 'Enter a port from 1 to 65535'
		}
	} else if (kind === 'tsigs') {
		if (name && !isHostname(name)) {
			fieldErrors.name = 'Use domain name form, such as transfer.example.com., with no spaces'
		}
		if (!values.algo.trim()) fieldErrors.algo = 'Choose the algorithm your other DNS provider uses'
		const secret = values.secret.trim()
		if (!secret) fieldErrors.secret = 'Paste the secret from your other DNS provider, or generate one'
		else if (!BASE64.test(secret)) {
			fieldErrors.secret = 'TSIG secrets are base64, using only letters, digits, + and / with = at the end'
		}
	} else {
		fieldErrors.ip_range = rangeError(values.ip_range.trim())
	}
	return !Object.values(fieldErrors).some(Boolean)
}

const focusFirstError = async () => {
	await nextTick()
	const invalid = fieldsRoot.value?.querySelector('[aria-invalid="true"]')
	const target = invalid?.matches('input, textarea, button')
		? invalid
		: invalid?.querySelector('input, textarea, button')
	target?.focus()
}

// Cloudflare creates a peer from its name alone, so the rest is saved with an update straight
// after. If that fails the peer exists, so the panel switches to editing it.
const createPeer = async (item) => {
	const id = zoneId.value
	const created = await resources.peers.create({ name: item.name })
	if (!created?.id || id !== zoneId.value || Object.keys(item).every((key) => key === 'name')) return created
	try {
		return await resources.peers.update(created.id, item)
	} catch (error) {
		error.createdPeer = created
		throw error
	}
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

	const kind = panelKind.value
	const id = zoneId.value
	const item = desired.value
	const { noun } = KINDS[kind]
	const title = capitalise(noun)

	if (editing.value && JSON.stringify(item) === JSON.stringify(baseline.value)) {
		notify.success('No changes to save', editing.value.name)
		panelOpen.value = false
		return
	}

	saving.value = true
	try {
		let result
		if (editing.value) result = await resources[kind].update(editing.value.id, item)
		else if (kind === 'peers') result = await createPeer(item)
		else result = await resources[kind].create(item)
		if (id !== zoneId.value) return
		notify.success(editing.value ? `${title} saved` : `${title} created`, result?.name || item.name)
		panelOpen.value = false
	} catch (error) {
		if (id !== zoneId.value) return
		const message = describeError(
			error,
			editing.value ? `Couldn’t save the ${noun}` : `Couldn’t create the ${noun}`
		)
		if (error?.createdPeer) {
			editing.value = error.createdPeer
			extraFields.value = splitItem('peers', error.createdPeer).rest
			saveError.value = `Cloudflare created the peer but didn’t save its other settings: ${message} Save again to retry.`
		} else {
			saveError.value = message
		}
	} finally {
		saving.value = false
	}
}

const onPanelClosed = () => {
	editing.value = null
	extraFields.value = {}
	secretShown.value = false
	jsonDirty.value = false
	form.value = defaultForm(panelKind.value)
	resetErrors()
}

// --- Delete ------------------------------------------------------------------------------

const deleteOpen = ref(false)
const deleteKind = ref('peers')
const deleteTarget = ref(null)

const deleteDescription = computed(() => {
	const target = deleteTarget.value
	if (deleteKind.value === 'peers') {
		return 'Zones linked to this peer will stop transferring with it: Cloudflare won’t transfer from it or send it NOTIFY messages. This can’t be undone.'
	}
	if (deleteKind.value === 'tsigs') {
		return 'Zones whose transfers are signed with this key will stop transferring until their peers use another key. This can’t be undone.'
	}
	const range = target?.ip_range ? ` ${target.ip_range}` : ' this range'
	return `Zones that rely on it will stop transferring: Cloudflare won’t accept NOTIFY messages from${range} or let name servers there transfer zones where Cloudflare is primary. This can’t be undone.`
})

const askDelete = (kind, item) => {
	deleteKind.value = kind
	deleteTarget.value = item
	deleteOpen.value = true
}

const deleteItem = async () => {
	const kind = deleteKind.value
	const item = deleteTarget.value
	if (!item) return
	await resources[kind].remove(item.id)
	notify.success(`${capitalise(KINDS[kind].noun)} deleted`, item.name || item.id)
	if (panelKind.value === kind && editing.value?.id === item.id) panelOpen.value = false
	// Peers that used a deleted key may have changed at Cloudflare too.
	if (kind === 'tsigs' && peersUsing(item.id).length) resources.peers.refresh()
}

watch(
	zoneId,
	(id) => {
		if (id) loadZone()
	},
	{ immediate: true }
)

// Panels opened for one zone's account shouldn't stay open after switching zones, and
// revealed secrets shouldn't stay revealed.
watch(
	[zoneId, canUse],
	([id, available], previous) => {
		if (previous && previous[0] !== id) {
			panelOpen.value = false
			deleteOpen.value = false
			revealed.value = new Set()
		}
		if (id && available) loadAll()
	},
	{ immediate: true }
)
</script>
