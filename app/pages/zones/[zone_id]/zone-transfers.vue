<template>
	<UDashboardPanel id="zone-transfers">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span>Zone transfers</span>
					<span v-if="zoneName" class="text-muted hidden truncate font-normal sm:inline">
						· {{ zoneName }}
					</span>
				</template>

				<template #right>
					<UButton
						v-if="canUse"
						icon="i-lucide-refresh-cw"
						color="neutral"
						variant="ghost"
						aria-label="Refresh zone transfer settings"
						:loading="refreshing"
						@click="refreshAll"
					/>
					<UButton
						v-if="canUse && !zoneAccess.shared"
						label="Transfer peers"
						icon="i-lucide-network"
						color="neutral"
						variant="outline"
						:to="peersPage"
					/>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<ZoneAccessNote :access="zoneAccess" area="dns" subject="zone transfers" />
			<AccountFeatureGate
				:loaded="capabilitiesLoaded"
				:available="canUse"
				feature="zone transfers"
				:reason="accessReason"
				hint="Zone transfers need Secondary DNS, which Cloudflare offers on Enterprise plans. The token needs Account Settings access for this account and DNS access for this zone, with Edit to make changes."
				:checking="zoneLoading"
				@retry="refreshZone"
			>
				<div class="mx-auto flex w-full max-w-3xl flex-col gap-10">
					<div class="flex flex-col gap-4">
						<p class="text-muted text-sm">
							Zone transfers copy {{ zoneName || 'this zone' }} between Cloudflare and name servers at
							other DNS providers. Each direction links the zone to peers, which belong to
							{{ accountName ? `the ${accountName} account` : 'the zone’s Cloudflare account' }} and are
							managed on the
							<ULink
								raw
								:to="peersPage"
								class="text-primary focus-visible:outline-primary rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
								>Transfer peers</ULink
							>
							page.
						</p>

						<UAlert
							v-if="peersError"
							color="warning"
							variant="subtle"
							icon="i-lucide-triangle-alert"
							title="Couldn’t load this account’s peers"
							:description="`${peersError} Linked peers are shown by ID until they load.`"
							:actions="[
								{
									label: 'Try again',
									icon: 'i-lucide-refresh-cw',
									color: 'neutral',
									variant: 'outline',
									loading: peersLoading,
									onClick: refreshPeers
								}
							]"
						/>
					</div>

					<section
						v-for="direction in DIRECTION_LIST"
						:key="direction.key"
						:aria-labelledby="`${direction.key}-heading`"
						class="flex flex-col gap-3"
					>
						<div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
							<div class="flex min-w-0 flex-col gap-1">
								<h2 :id="`${direction.key}-heading`" class="text-highlighted text-base font-semibold">
									{{ direction.heading }}
								</h2>
								<p class="text-muted text-sm">{{ direction.summary }}</p>
							</div>

							<div
								v-if="sections[direction.key].status === 'ready'"
								class="flex flex-wrap items-center gap-2"
							>
								<UButton
									v-if="canEdit && direction.key === 'incoming'"
									label="Transfer now"
									icon="i-lucide-download"
									size="sm"
									color="neutral"
									variant="outline"
									:loading="busy.axfr"
									@click="forceAxfr"
								/>
								<UButton
									v-else-if="canEdit"
									label="Notify secondaries now"
									icon="i-lucide-bell-ring"
									size="sm"
									color="neutral"
									variant="outline"
									:loading="busy.notify"
									:disabled="!sections.outgoing.config?.peers?.length"
									@click="forceNotify"
								/>
								<UButton
									v-if="canEdit"
									label="Edit"
									icon="i-lucide-pencil"
									size="sm"
									color="neutral"
									variant="outline"
									:aria-label="`Edit ${direction.noun}`"
									@click="openConfig(direction.key)"
								/>
								<UDropdownMenu :items="sectionMenu(direction)" :content="{ align: 'end' }">
									<UButton
										icon="i-lucide-ellipsis-vertical"
										size="sm"
										color="neutral"
										variant="ghost"
										:aria-label="`More actions for ${direction.noun}`"
									/>
								</UDropdownMenu>
							</div>
						</div>

						<div
							v-if="
								sections[direction.key].status === 'idle' ||
								sections[direction.key].status === 'loading'
							"
							class="flex flex-col gap-2"
							aria-busy="true"
						>
							<span class="sr-only" role="status">Loading {{ direction.noun }}…</span>
							<USkeleton v-for="n in 3" :key="n" class="h-10 w-full" />
						</div>

						<UAlert
							v-else-if="sections[direction.key].status === 'error'"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							role="alert"
							:title="`Couldn’t load ${direction.noun}`"
							:description="sections[direction.key].message"
							:actions="[
								{
									label: 'Try again',
									icon: 'i-lucide-refresh-cw',
									color: 'neutral',
									variant: 'outline',
									loading: sections[direction.key].loading,
									onClick: () => loadDirection(direction.key)
								}
							]"
						/>

						<div
							v-else-if="sections[direction.key].status === 'absent'"
							class="border-default flex flex-col gap-3 border-y py-4 text-sm"
						>
							<p class="text-default">
								{{
									sections[direction.key].confirmed
										? `${capitalise(direction.label)} aren’t set up for ${zoneName || 'this zone'}.`
										: `Cloudflare didn’t return ${direction.noun} for ${zoneName || 'this zone'}, so they’re probably not set up yet.`
								}}
							</p>
							<p v-if="direction.key === 'incoming' && setupNote" class="text-muted">{{ setupNote }}</p>
							<p v-if="sections[direction.key].message" class="text-muted">
								Cloudflare said: {{ sections[direction.key].message }}
							</p>
							<div class="flex flex-wrap items-center gap-2">
								<UButton
									v-if="canEdit"
									:label="direction.setupLabel"
									icon="i-lucide-plus"
									size="sm"
									@click="openConfig(direction.key)"
								/>
								<UButton
									label="Try again"
									icon="i-lucide-refresh-cw"
									size="sm"
									color="neutral"
									variant="ghost"
									:loading="sections[direction.key].loading"
									@click="loadDirection(direction.key)"
								/>
								<UButton
									label="Open in Console"
									icon="i-lucide-square-terminal"
									size="sm"
									color="neutral"
									variant="ghost"
									:to="consoleLink(direction.commands.get)"
								/>
							</div>
						</div>

						<template v-else-if="sections[direction.key].status === 'ready'">
							<template v-if="direction.key === 'outgoing'">
								<div v-if="outgoingStatus.enabled === null" class="flex flex-col gap-2">
									<div
										v-if="outgoingStatus.loading && !outgoingStatus.error"
										class="flex flex-col gap-2"
										aria-busy="true"
									>
										<span class="sr-only" role="status"
											>Checking whether outgoing transfers are on…</span
										>
										<USkeleton class="h-14 w-full" />
									</div>
									<UAlert
										v-else
										color="warning"
										variant="subtle"
										icon="i-lucide-triangle-alert"
										title="Couldn’t tell whether outgoing transfers are on"
										:description="
											outgoingStatus.error ||
											(outgoingStatus.raw
												? `Cloudflare reported the status as “${outgoingStatus.raw}”.`
												: 'Cloudflare didn’t return a status.')
										"
										:actions="[
											{
												label: 'Try again',
												icon: 'i-lucide-refresh-cw',
												color: 'neutral',
												variant: 'outline',
												loading: outgoingStatus.loading,
												onClick: loadOutgoingStatus
											}
										]"
									/>
								</div>
								<USwitch
									v-else
									:model-value="outgoingStatus.enabled"
									:loading="busy.toggle"
									:disabled="busy.toggle || !canEdit"
									label="Outgoing transfers"
									:description="
										outgoingStatus.enabled
											? `On. Secondaries can transfer ${zoneName || 'this zone'} from Cloudflare, and linked peers get a NOTIFY when it changes.`
											: `Off. Cloudflare refuses transfers of ${zoneName || 'this zone'} and sends no NOTIFY messages until this is on.`
									"
									:ui="{ root: 'border-default rounded-md border p-3' }"
									@update:model-value="setOutgoingEnabled"
								/>
							</template>

							<dl class="divide-default border-default divide-y border-y text-sm">
								<div :class="rowClass">
									<dt class="text-muted">Zone name</dt>
									<dd class="text-highlighted min-w-0 font-mono break-all">
										{{ sections[direction.key].config?.name || 'Not set' }}
									</dd>
								</div>

								<div :class="rowClass">
									<dt class="text-muted">
										{{
											direction.key === 'incoming'
												? 'Primary name servers'
												: 'Secondary name servers'
										}}
									</dt>
									<dd class="min-w-0">
										<ul
											v-if="sections[direction.key].config?.peers?.length"
											class="flex flex-col gap-1"
											:aria-label="`Peers linked for ${direction.noun}`"
										>
											<li
												v-for="peerId in sections[direction.key].config.peers"
												:key="peerId"
												class="flex min-w-0 flex-wrap items-baseline gap-x-2"
											>
												<template v-if="findPeer(peerId)">
													<span class="text-highlighted">{{ findPeer(peerId).name }}</span>
													<code class="text-muted font-mono text-xs">{{
														peerAddress(findPeer(peerId))
													}}</code>
												</template>
												<template v-else>
													<span class="text-muted">{{
														peersLoading ? 'Loading peer…' : 'Peer not found'
													}}</span>
													<code class="text-dimmed font-mono text-xs break-all">{{
														peerId
													}}</code>
												</template>
											</li>
										</ul>
										<span v-else class="text-muted">No peers linked</span>
									</dd>
								</div>

								<div v-if="direction.key === 'incoming'" :class="rowClass">
									<dt class="text-muted">Refresh interval</dt>
									<dd class="text-default">
										{{
											describeSeconds(sections.incoming.config?.auto_refresh_seconds) || 'Not set'
										}}
									</dd>
								</div>

								<div v-if="hasValue(sections[direction.key].config?.soa_serial)" :class="rowClass">
									<dt class="text-muted">SOA serial</dt>
									<dd class="text-default font-mono">
										{{ sections[direction.key].config.soa_serial }}
									</dd>
								</div>

								<div v-for="field in timeFields(direction.key)" :key="field.key" :class="rowClass">
									<dt class="text-muted">{{ field.label }}</dt>
									<dd class="text-default">
										<time :datetime="sections[direction.key].config[field.key]">{{
											formatDate(sections[direction.key].config[field.key], 'datetime')
										}}</time>
									</dd>
								</div>
							</dl>

							<p
								v-if="direction.key === 'outgoing' && !sections.outgoing.config?.peers?.length"
								class="text-muted text-sm"
							>
								With no peers linked, Cloudflare sends no NOTIFY messages. Secondaries at addresses in
								the account’s ACLs can still transfer the zone.
							</p>

							<AccountJsonPanel :value="sections[direction.key].config || {}" />
						</template>
					</section>
				</div>
			</AccountFeatureGate>

			<AccountFormSlideover
				v-model:open="panelOpen"
				:title="panelTitle"
				:description="
					panelEditing ? 'Saving replaces the whole configuration with the values below.' : panelIntro
				"
				:submit-label="panelEditing ? 'Save changes' : DIRECTIONS[panelDirection].setupLabel"
				:saving="saving"
				:error="saveError"
				:error-title="panelEditing ? 'Cloudflare didn’t save the changes' : 'Cloudflare didn’t set it up'"
				@submit="submitConfig"
				@after:leave="onPanelClosed"
			>
				<div ref="fieldsRoot" class="flex flex-col gap-5">
					<UFormField
						label="Zone name"
						required
						description="The name your other name servers know this zone by."
						:error="fieldErrors.name || false"
					>
						<UInput
							v-model="form.name"
							:placeholder="zoneName || 'example.com'"
							autocomplete="off"
							spellcheck="false"
							autocapitalize="off"
							class="w-full"
							:ui="{ base: 'font-mono' }"
						/>
					</UFormField>

					<UFormField
						v-if="panelDirection === 'incoming'"
						label="Refresh interval (seconds)"
						required
						:description="refreshDescription"
						:error="fieldErrors.auto_refresh_seconds || false"
					>
						<UInputNumber
							v-model="form.auto_refresh_seconds"
							:min="1"
							:step="60"
							:step-snapping="false"
							:placeholder="String(DEFAULT_REFRESH)"
							class="w-full"
						/>
					</UFormField>

					<UFormField
						:label="panelDirection === 'incoming' ? 'Primary name servers' : 'Secondary name servers'"
						:required="panelDirection === 'incoming'"
						:description="peersDescription"
						:error="fieldErrors.peers || false"
					>
						<USelectMenu
							v-model="form.peers"
							:items="peerOptions"
							multiple
							value-key="id"
							label-key="name"
							:filter-fields="['name', 'description', 'id']"
							:loading="peersLoading"
							:search-input="{ placeholder: 'Search peers by name or IP' }"
							class="w-full"
						>
							<template #default="{ modelValue }">
								<span v-if="modelValue?.length" class="truncate">
									{{
										modelValue.length === 1
											? '1 peer selected'
											: `${modelValue.length} peers selected`
									}}
								</span>
								<span v-else class="text-dimmed truncate">Choose peers</span>
							</template>

							<template #empty="{ searchTerm }">
								<span v-if="searchTerm">No peer matches “{{ searchTerm }}”</span>
								<span v-else-if="peersLoading">Loading peers…</span>
								<span v-else>This account has no peers yet</span>
							</template>
						</USelectMenu>

						<ul v-if="form.peers.length" class="divide-default mt-2 divide-y" aria-label="Selected peers">
							<li
								v-for="peerId in form.peers"
								:key="peerId"
								class="flex items-center justify-between gap-2 py-1.5"
							>
								<div class="flex min-w-0 flex-col">
									<span v-if="findPeer(peerId)" class="text-highlighted truncate text-sm">{{
										findPeer(peerId).name
									}}</span>
									<span v-else class="text-muted text-sm">Peer not found</span>
									<code class="text-dimmed truncate font-mono text-xs">{{
										findPeer(peerId) ? peerAddress(findPeer(peerId)) : peerId
									}}</code>
								</div>
								<UButton
									icon="i-lucide-x"
									size="xs"
									color="neutral"
									variant="ghost"
									:aria-label="`Remove ${findPeer(peerId)?.name || peerId}`"
									@click="removePeer(peerId)"
								/>
							</li>
						</ul>

						<p class="text-muted mt-2 text-sm">
							Add or change peers on the
							<ULink
								raw
								:to="peersPage"
								class="text-primary focus-visible:outline-primary rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
								>Transfer peers</ULink
							>
							page.
						</p>
					</UFormField>

					<UAlert
						v-if="mixedTsig"
						color="warning"
						variant="subtle"
						icon="i-lucide-triangle-alert"
						title="These peers use different TSIG keys"
						description="When any peer linked to a zone uses TSIG, Cloudflare expects all of them to use the same key."
					/>

					<USwitch
						v-if="panelDirection === 'outgoing' && !panelEditing"
						v-model="form.enable"
						label="Turn on outgoing transfers now"
						description="Secondaries can only transfer the zone while this is on. You can change it later."
					/>
				</div>
			</AccountFormSlideover>

			<AccountDeleteModal
				v-model:open="deleteOpen"
				:title="DIRECTIONS[deleteDirection].deleteTitle"
				:description="deleteDescription"
				:confirm-label="DIRECTIONS[deleteDirection].deleteLabel"
				:action="deleteConfig"
			/>
		</template>
	</UDashboardPanel>
</template>

<script setup>
// Cloudflare's default when a secondary zone is set up without one.
const DEFAULT_REFRESH = 86_400

const DIRECTIONS = {
	incoming: {
		key: 'incoming',
		heading: 'Cloudflare as secondary',
		label: 'incoming transfers',
		noun: 'incoming transfer settings',
		setupLabel: 'Set up incoming transfers',
		deleteTitle: 'Delete the incoming transfer settings?',
		deleteLabel: 'Delete incoming settings',
		commands: {
			get: 'dns zone-transfers incoming get',
			create: 'dns zone-transfers incoming create',
			update: 'dns zone-transfers incoming update',
			delete: 'dns zone-transfers incoming delete'
		}
	},
	outgoing: {
		key: 'outgoing',
		heading: 'Cloudflare as primary',
		label: 'outgoing transfers',
		noun: 'outgoing transfer settings',
		setupLabel: 'Set up outgoing transfers',
		deleteTitle: 'Delete the outgoing transfer settings?',
		deleteLabel: 'Delete outgoing settings',
		commands: {
			get: 'dns zone-transfers outgoing get',
			create: 'dns zone-transfers outgoing create',
			update: 'dns zone-transfers outgoing update',
			delete: 'dns zone-transfers outgoing delete'
		}
	}
}

const TIME_FIELDS = {
	incoming: [
		{ key: 'checked_time', label: 'Last checked' },
		{ key: 'modified_time', label: 'Modified' },
		{ key: 'created_time', label: 'Created' }
	],
	outgoing: [
		{ key: 'last_transferred_time', label: 'Last transferred' },
		{ key: 'checked_time', label: 'Last checked' },
		{ key: 'modified_time', label: 'Modified' },
		{ key: 'created_time', label: 'Created' }
	]
}

const SETUP_NAMES = { full: 'full', partial: 'partial (CNAME)', internal: 'internal' }

const rowClass = 'grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6'

const route = useRoute()
const notify = useNotify()
const { exec } = useCfCommands()
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
	refresh: refreshZone,
	access: zoneAccess,
	allowed
} = useZone(() => route.params.zone_id)
// On a zone shared with this account, what its DNS level allows (own zones allow everything).
const canEdit = computed(() => allowed('dns', 'edit'))
const canDelete = computed(() => allowed('dns', 'delete'))

// The same list, and cache, as the Transfer peers page, so peers added there show up here.
const {
	items: peerList,
	loading: peersLoading,
	error: peersError,
	load: loadPeers,
	refresh: refreshPeers
} = useAccountResource(zoneId, { commands: { list: 'dns zone-transfers peers list' }, label: 'peer' })

const accountName = computed(() => zone.value?.account?.name || '')
const canUse = computed(() => can('zoneTransfers'))
const accessReason = computed(
	() => missingCapabilities.value.find((item) => item.key === 'zoneTransfers')?.reason || ''
)
const peersPage = computed(() => `/zones/${zoneId.value}/transfer-peers`)

useSeoMeta({ title: computed(() => (zoneName.value ? `Zone transfers · ${zoneName.value}` : 'Zone transfers')) })

const DIRECTION_LIST = computed(() => {
	const name = zoneName.value || 'this zone'
	return [
		{
			...DIRECTIONS.incoming,
			summary: `Cloudflare copies ${name} from your primary name servers and answers queries with it. It checks for changes when your primary sends a NOTIFY, and on the refresh interval regardless.`
		},
		{
			...DIRECTIONS.outgoing,
			summary: `Your secondary name servers copy ${name} from Cloudflare. Cloudflare notifies the linked peers when the zone changes, and accepts transfer requests from addresses in the account’s ACLs.`
		}
	]
})

// Cloudflare only pulls a zone in from a primary when it was added with a secondary setup.
const setupNote = computed(() => {
	const type = zone.value?.type
	if (!type || type === 'secondary') return ''
	return `Incoming transfers are for zones added to Cloudflare with a secondary setup. ${zoneName.value || 'This zone'} has a ${SETUP_NAMES[type] || type} setup.`
})

// --- Peers -------------------------------------------------------------------------------

const peerById = computed(() => new Map(peerList.value.map((peer) => [peer.id, peer])))
const findPeer = (id) => peerById.value.get(id) || null

const peerAddress = (peer) => {
	if (!peer?.ip) return 'No IP address'
	if (!peer.port) return peer.ip
	return peer.ip.includes(':') ? `[${peer.ip}]:${peer.port}` : `${peer.ip}:${peer.port}`
}

// --- Loading -----------------------------------------------------------------------------

// Cloudflare answers a zone with no transfer settings with an error rather than an empty
// result, and doesn't document which one. Messages about something not existing count as
// “not set up”; anything about the token, the plan or access never does.
const ACCESS_CODES = new Set([6003, 6111, 9109, 10000, 10001])
const ACCESS_MESSAGE = /auth|permission|forbidden|not allowed|entitle|access|token|plan|upgrade|HTTP Error: 40[13]/i
const MISSING_MESSAGE =
	/not found|not exist|doesn[’']t exist|no such|not configured|not set up|not an? (?:primary|secondary)|HTTP Error: 404/i

// 'missing' when Cloudflare says there's nothing there, 'unsure' for another Cloudflare error
// that isn't about access, and 'failed' for everything else.
const classifyLoadError = (error) => {
	if (!(error instanceof CfApiError)) return 'failed'
	const errors = error.response?.errors || []
	const messages = errors.map((item) => String(item?.message || ''))
	if (errors.some((item) => ACCESS_CODES.has(item?.code)) || messages.some((text) => ACCESS_MESSAGE.test(text))) {
		return 'failed'
	}
	if (messages.some((text) => MISSING_MESSAGE.test(text))) return 'missing'
	// Errors without a code come from this app (a timeout, say), not from Cloudflare.
	return errors.some((item) => typeof item?.code === 'number') ? 'unsure' : 'failed'
}

// status: idle, loading (first load), ready, absent (not set up) or error. `request` makes
// answers to superseded requests drop, including ones sent for the previous zone.
const createSection = () => ({ status: 'idle', config: null, message: '', confirmed: false, loading: false })
const sections = reactive({ incoming: createSection(), outgoing: createSection() })
const requests = { incoming: 0, outgoing: 0, status: 0 }
let requestSequence = 0

const outgoingStatus = reactive({ enabled: null, raw: '', error: '', loading: false })
const busy = reactive({ axfr: false, notify: false, toggle: false })

// Cloudflare reports the outgoing status as a string such as "Enabled" or "Disabled".
const readEnabled = (result) => {
	const text = typeof result === 'string' ? result.trim() : ''
	if (/^enabled$/i.test(text)) return true
	if (/^disabled$/i.test(text)) return false
	return null
}

const loadOutgoingStatus = async () => {
	const id = zoneId.value
	if (!id) return
	const request = ++requestSequence
	requests.status = request
	outgoingStatus.loading = true
	outgoingStatus.error = ''
	try {
		const response = await exec(
			'dns zone-transfers outgoing status get',
			{ zone: id },
			{ fallback: 'Couldn’t read the outgoing transfer status' }
		)
		if (requests.status !== request) return
		outgoingStatus.raw = typeof response?.result === 'string' ? response.result : ''
		outgoingStatus.enabled = readEnabled(response?.result)
	} catch (error) {
		if (requests.status !== request) return
		outgoingStatus.enabled = null
		outgoingStatus.error = describeError(error, 'Couldn’t read the outgoing transfer status')
	} finally {
		if (requests.status === request) outgoingStatus.loading = false
	}
}

const absent = (confirmed, message = '') => ({ status: 'absent', config: null, message, confirmed })

const loadDirection = async (key) => {
	const id = zoneId.value
	if (!id) return
	const section = sections[key]
	const request = ++requestSequence
	requests[key] = request
	section.loading = true
	if (section.status === 'idle' || section.status === 'error') section.status = 'loading'
	const fallback = `Couldn’t load the ${DIRECTIONS[key].noun}`
	try {
		const response = await exec(DIRECTIONS[key].commands.get, { zone: id }, { fallback })
		if (requests[key] !== request) return
		Object.assign(section, response?.result ? { status: 'ready', config: response.result } : absent(true))
	} catch (error) {
		if (requests[key] !== request) return
		const kind = classifyLoadError(error)
		const message = describeError(error, fallback)
		if (kind === 'failed') Object.assign(section, { status: 'error', config: null, message, confirmed: false })
		else Object.assign(section, absent(kind === 'missing', message))
	} finally {
		if (requests[key] === request) section.loading = false
	}
	if (key === 'outgoing' && requests.outgoing === request && section.status === 'ready') loadOutgoingStatus()
}

// A local change supersedes any load still in flight for that direction.
const storeConfig = (key, config) => {
	requests[key] = ++requestSequence
	Object.assign(sections[key], config ? { status: 'ready', config, message: '' } : absent(true), {
		loading: false
	})
}

const loadAll = () => {
	loadDirection('incoming')
	loadDirection('outgoing')
	loadPeers()
}

const refreshAll = () => {
	loadDirection('incoming')
	loadDirection('outgoing')
	refreshPeers()
}

const refreshing = computed(
	() => sections.incoming.loading || sections.outgoing.loading || outgoingStatus.loading || peersLoading.value
)

const resetForZone = () => {
	panelOpen.value = false
	deleteOpen.value = false
	for (const key of Object.keys(requests)) requests[key] = ++requestSequence
	Object.assign(sections.incoming, createSection())
	Object.assign(sections.outgoing, createSection())
	Object.assign(outgoingStatus, { enabled: null, raw: '', error: '', loading: false })
	Object.assign(busy, { axfr: false, notify: false, toggle: false })
}

// --- Display -----------------------------------------------------------------------------

const hasValue = (value) => value !== undefined && value !== null && value !== ''
const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1)

const describeSeconds = (value) => {
	const seconds = Number(value)
	if (!Number.isFinite(seconds) || seconds <= 0) return ''
	if (seconds < 60) return plural(seconds, 'second')
	return `${formatTtl(seconds, { style: 'long' })} (${plural(seconds, 'second')})`
}

const timeFields = (key) => TIME_FIELDS[key].filter((field) => formatDate(sections[key].config?.[field.key]))

const consoleLink = (command) => ({ path: '/console', query: { command, zone: zoneId.value } })

const sectionMenu = (direction) => {
	const links = [
		{
			label: 'Open in Console',
			icon: 'i-lucide-square-terminal',
			to: consoleLink(direction.commands.get)
		}
	]
	if (direction.key === 'outgoing') {
		links.push({
			label: 'Open status in Console',
			icon: 'i-lucide-square-terminal',
			to: consoleLink('dns zone-transfers outgoing status get')
		})
	}
	if (!canDelete.value) return [links]
	return [
		links,
		[
			{
				label: 'Delete settings',
				icon: 'i-lucide-trash-2',
				color: 'error',
				onSelect: () => askDelete(direction.key)
			}
		]
	]
}

// --- Actions -----------------------------------------------------------------------------

const forceAxfr = async () => {
	const id = zoneId.value
	if (!id || busy.axfr) return
	busy.axfr = true
	const fallback = 'Cloudflare didn’t start the transfer'
	try {
		await exec('dns zone-transfers force-axfr create', { zone: id }, { fallback })
		if (id !== zoneId.value) return
		notify.success(
			'Transfer requested',
			`Cloudflare is asking your primary name servers for a full copy of ${zoneName.value || 'the zone'}. Refresh shortly to see the new SOA serial.`
		)
	} catch (error) {
		if (id === zoneId.value) notify.error('Couldn’t start the transfer', error, fallback)
	} finally {
		if (id === zoneId.value) busy.axfr = false
	}
}

const forceNotify = async () => {
	const id = zoneId.value
	if (!id || busy.notify) return
	busy.notify = true
	const fallback = 'Cloudflare didn’t send the NOTIFY'
	try {
		await exec('dns zone-transfers outgoing force-notify', { zone: id }, { fallback })
		if (id !== zoneId.value) return
		notify.success(
			'Secondaries notified',
			`Cloudflare sent a NOTIFY for ${zoneName.value || 'the zone'} to the linked peers.`
		)
	} catch (error) {
		if (id === zoneId.value) notify.error('Couldn’t notify the secondaries', error, fallback)
	} finally {
		if (id === zoneId.value) busy.notify = false
	}
}

// Optimistic: the switch moves at once and returns to its old position if Cloudflare refuses.
const setOutgoingEnabled = async (value) => {
	const id = zoneId.value
	if (!id || busy.toggle) return
	const previous = outgoingStatus.enabled
	requests.status = ++requestSequence
	outgoingStatus.enabled = value
	busy.toggle = true
	const fallback = 'Cloudflare rejected the change'
	try {
		const response = await exec(
			value ? 'dns zone-transfers outgoing enable' : 'dns zone-transfers outgoing disable',
			{ zone: id },
			{ fallback }
		)
		if (id !== zoneId.value) return
		const confirmed = readEnabled(response?.result)
		if (confirmed !== null) outgoingStatus.enabled = confirmed
		notify.success(
			value ? 'Outgoing transfers turned on' : 'Outgoing transfers turned off',
			zoneName.value || undefined
		)
	} catch (error) {
		if (id !== zoneId.value) return
		outgoingStatus.enabled = previous
		notify.error(
			value ? 'Couldn’t turn on outgoing transfers' : 'Couldn’t turn off outgoing transfers',
			error,
			fallback
		)
	} finally {
		if (id === zoneId.value) busy.toggle = false
	}
}

// --- Set up and edit ---------------------------------------------------------------------

const panelOpen = ref(false)
const panelDirection = ref('incoming')
const panelEditing = ref(false)
const form = reactive({ name: '', auto_refresh_seconds: DEFAULT_REFRESH, peers: [], enable: true })
const fieldErrors = reactive({ name: '', auto_refresh_seconds: '', peers: '' })
const saveError = ref('')
const saving = ref(false)
const fieldsRoot = useTemplateRef('fieldsRoot')

const panelTitle = computed(() => {
	const direction = DIRECTIONS[panelDirection.value]
	return panelEditing.value ? `Edit ${direction.noun}` : direction.setupLabel
})

const panelIntro = computed(() =>
	panelDirection.value === 'incoming'
		? `Cloudflare will transfer ${zoneName.value || 'the zone'} from the peers you choose.`
		: `The peers you choose get a NOTIFY from Cloudflare whenever ${zoneName.value || 'the zone'} changes.`
)

const refreshDescription = computed(() => {
	const current = describeSeconds(form.auto_refresh_seconds)
	const base = `How often Cloudflare checks your primary for changes, even without a NOTIFY. Cloudflare’s default is ${formatNumber(DEFAULT_REFRESH)} seconds (1 day).`
	return current ? `${base} Now: ${current}.` : base
})

const peersDescription = computed(() =>
	panelDirection.value === 'incoming'
		? 'The primary name servers Cloudflare transfers the zone from.'
		: 'The secondary name servers Cloudflare sends a NOTIFY to when the zone changes. Optional.'
)

// Peers from the account, plus any linked ID the list doesn't contain, so saving never
// drops a peer just because the list failed to load.
const peerOptions = computed(() => {
	const options = [...peerList.value]
		.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
		.map((peer) => ({ id: peer.id, name: peer.name || peer.id, description: peerAddress(peer) }))
	for (const id of form.peers) {
		if (!peerById.value.has(id)) options.push({ id, name: id, description: 'Peer not found in this account' })
	}
	return options
})

// Cloudflare expects every linked peer to share one TSIG key once any of them uses TSIG.
const mixedTsig = computed(() => {
	const keys = form.peers.map((id) => findPeer(id)).filter(Boolean)
	if (keys.length < 2) return false
	return new Set(keys.map((peer) => peer.tsig_id || '')).size > 1
})

const removePeer = (id) => {
	form.peers = form.peers.filter((existing) => existing !== id)
}

const resetErrors = () => {
	Object.assign(fieldErrors, { name: '', auto_refresh_seconds: '', peers: '' })
	saveError.value = ''
}

const openConfig = (key) => {
	const config = sections[key].status === 'ready' ? sections[key].config : null
	panelDirection.value = key
	panelEditing.value = Boolean(config)
	const refresh = Number(config?.auto_refresh_seconds)
	Object.assign(form, {
		name: config?.name || zoneName.value || '',
		auto_refresh_seconds: Number.isFinite(refresh) && refresh > 0 ? refresh : DEFAULT_REFRESH,
		peers: Array.isArray(config?.peers) ? [...new Set(config.peers.map(String))] : [],
		enable: true
	})
	resetErrors()
	panelOpen.value = true
	loadPeers()
}

const validate = () => {
	resetErrors()
	const name = form.name.trim()
	if (!name) fieldErrors.name = `Enter the zone’s name, such as ${zoneName.value || 'example.com'}`
	else if (!isHostname(name)) fieldErrors.name = `“${name}” isn’t a zone name. Use a name like example.com`

	if (panelDirection.value === 'incoming') {
		const seconds = form.auto_refresh_seconds
		if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1) {
			fieldErrors.auto_refresh_seconds = `Enter a whole number of seconds, such as ${formatNumber(DEFAULT_REFRESH)}`
		}
		if (!form.peers.length) {
			fieldErrors.peers = peerList.value.length
				? 'Choose at least one peer for Cloudflare to transfer the zone from'
				: 'Add a peer for your primary name server on the Transfer peers page first'
		}
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

// Updates are PUTs, so the full configuration is always sent.
const configBody = () => {
	const body = { name: form.name.trim(), peers: [...form.peers] }
	if (panelDirection.value === 'incoming') body.auto_refresh_seconds = form.auto_refresh_seconds
	return body
}

const turnOnOutgoing = async (id) => {
	try {
		const response = await exec(
			'dns zone-transfers outgoing enable',
			{ zone: id },
			{ fallback: 'Cloudflare rejected the change' }
		)
		if (id !== zoneId.value) return
		const confirmed = readEnabled(response?.result)
		if (confirmed !== null) {
			requests.status = ++requestSequence
			Object.assign(outgoingStatus, { enabled: confirmed, raw: response.result, error: '', loading: false })
		} else loadOutgoingStatus()
	} catch (error) {
		if (id !== zoneId.value) return
		notify.warning(
			'Outgoing transfers are set up but off',
			`${describeError(error, 'Cloudflare rejected the change')} Turn them on from the switch when you’re ready.`
		)
		loadOutgoingStatus()
	}
}

const submitConfig = async () => {
	if (saving.value) return
	if (!validate()) {
		focusFirstError()
		return
	}

	const id = zoneId.value
	const key = panelDirection.value
	const editing = panelEditing.value
	const enable = key === 'outgoing' && !editing && form.enable
	const fallback = editing ? 'Couldn’t save the changes' : 'Couldn’t set up zone transfers'
	saving.value = true
	try {
		const response = await exec(
			DIRECTIONS[key].commands[editing ? 'update' : 'create'],
			{ zone: id, body: configBody() },
			{ fallback }
		)
		if (id !== zoneId.value) return
		if (response?.result && typeof response.result === 'object') storeConfig(key, response.result)
		else loadDirection(key)
		if (enable) await turnOnOutgoing(id)
		else if (key === 'outgoing' && !editing) loadOutgoingStatus()
		if (id !== zoneId.value) return
		notify.success(
			editing
				? 'Zone transfer settings saved'
				: key === 'incoming'
					? 'Incoming transfers set up'
					: 'Outgoing transfers set up',
			zoneName.value || undefined
		)
		panelOpen.value = false
	} catch (error) {
		if (id === zoneId.value) saveError.value = describeError(error, fallback)
	} finally {
		saving.value = false
	}
}

const onPanelClosed = () => {
	resetErrors()
}

// --- Delete ------------------------------------------------------------------------------

const deleteOpen = ref(false)
const deleteDirection = ref('incoming')

const deleteDescription = computed(() => {
	const name = zoneName.value || 'this zone'
	return deleteDirection.value === 'incoming'
		? `Cloudflare will stop pulling ${name} from your primary name servers, so changes made there won’t reach Cloudflare. The peers stay in the account. This can’t be undone.`
		: `Cloudflare will stop serving transfers of ${name} and stop notifying the linked peers, so your secondary name servers won’t get changes made here. The peers stay in the account. This can’t be undone.`
})

const askDelete = (key) => {
	deleteDirection.value = key
	deleteOpen.value = true
}

const deleteConfig = async () => {
	const id = zoneId.value
	const key = deleteDirection.value
	await exec(DIRECTIONS[key].commands.delete, { zone: id }, { fallback: 'Couldn’t delete the settings' })
	if (id !== zoneId.value) return
	storeConfig(key, null)
	if (key === 'outgoing') {
		requests.status = ++requestSequence
		Object.assign(outgoingStatus, { enabled: null, raw: '', error: '', loading: false })
	}
	notify.success(
		key === 'incoming' ? 'Incoming transfer settings deleted' : 'Outgoing transfer settings deleted',
		zoneName.value || undefined
	)
}

watch(
	zoneId,
	(id) => {
		if (id) loadZone()
	},
	{ immediate: true }
)

// Switching zones closes anything opened for the previous one before loading the new one.
watch(
	[zoneId, canUse],
	([id, available], previous) => {
		if (previous && previous[0] !== id) resetForZone()
		if (id && available) loadAll()
	},
	{ immediate: true }
)
</script>
