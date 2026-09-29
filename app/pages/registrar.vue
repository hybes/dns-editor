<template>
	<UDashboardPanel id="registrar">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span>Registrar</span>
					<span v-if="accountName" class="text-muted hidden truncate font-normal sm:inline">
						· {{ accountName }}
					</span>
				</template>

				<template #right>
					<UTooltip v-if="accountId" text="Refresh registered domains">
						<UButton
							icon="i-lucide-refresh-cw"
							color="neutral"
							variant="ghost"
							aria-label="Refresh registered domains"
							:loading="list.loading"
							@click="refreshList"
						/>
					</UTooltip>
					<UButton
						v-if="accountId"
						icon="i-lucide-plus"
						label="Register a domain"
						@click="openRegister('')"
					/>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<p class="text-muted text-sm">
				Domains registered with Cloudflare Registrar in the chosen account. Registering one here charges the
				account’s default payment method, and it can’t be refunded.
			</p>

			<div class="flex flex-col gap-3 sm:flex-row sm:items-start">
				<UFormField
					label="Account"
					name="registrar-account"
					class="sm:w-80"
					:description="accountsError ? `Couldn’t load your accounts: ${accountsError}` : ''"
				>
					<USelectMenu
						v-model="accountId"
						:items="accountItems"
						value-key="value"
						:loading="accountsLoading && !accountItems.length"
						:search-input="accountItems.length > 8 ? { placeholder: 'Find an account…' } : false"
						placeholder="Choose an account"
						icon="i-lucide-building-2"
						class="w-full"
					/>
				</UFormField>
				<UFormField v-if="accountId" label="Sort by" name="registrar-sort" class="sm:w-56">
					<USelect v-model="sortBy" :items="SORT_ITEMS" class="w-full" />
				</UFormField>
			</div>

			<UEmpty
				v-if="!accountId"
				variant="naked"
				icon="i-lucide-building-2"
				:title="accountsLoading ? 'Loading your accounts…' : 'Choose an account'"
				description="Registered domains belong to a Cloudflare account. Choose one to see its domains or register a new one."
			/>

			<template v-else>
				<AccountResourceTable
					:data="list.items"
					:columns="columns"
					:loading="list.loading"
					:loaded="list.loaded"
					:error="list.error"
					error-title="Couldn’t load the registered domains"
					caption="Domains registered with Cloudflare Registrar"
					loading-label="Loading registered domains…"
					@retry="refreshList"
				>
					<template #empty>
						<UEmpty
							variant="naked"
							icon="i-lucide-badge-check"
							title="No domains registered with Cloudflare in this account"
							description="Register one here, or transfer one in from another registrar in the Cloudflare dashboard."
							:actions="[
								{ label: 'Register a domain', icon: 'i-lucide-plus', onClick: () => openRegister('') }
							]"
						/>
					</template>

					<template #domain_name-cell="{ row }">
						<div class="flex max-w-[55vw] min-w-0 flex-col gap-0.5 sm:max-w-80">
							<button
								type="button"
								class="text-highlighted focus-visible:outline-primary truncate rounded-sm text-start font-mono font-medium hover:underline focus-visible:outline-2"
								@click="openDetail(row.original)"
							>
								<span class="sr-only">Details for </span>{{ row.original.domain_name }}
							</button>
							<span class="text-muted truncate text-xs sm:hidden">
								{{ statusMeta(row.original.status).label }}
							</span>
							<span class="text-muted truncate text-xs md:hidden">{{ expiryLabel(row.original) }}</span>
						</div>
					</template>

					<template #status-cell="{ row }">
						<UBadge :color="statusMeta(row.original.status).color" variant="subtle" size="sm">
							{{ statusMeta(row.original.status).label }}
						</UBadge>
					</template>

					<template #expires_at-cell="{ row }">
						<time
							v-if="formatDate(row.original.expires_at)"
							:datetime="row.original.expires_at"
							:class="{ 'text-warning': expiresSoon(row.original) }"
						>
							{{ formatDate(row.original.expires_at) }}
						</time>
						<span v-else class="text-dimmed">Not yet known</span>
					</template>

					<template #auto_renew-cell="{ row }">
						<USwitch
							:model-value="row.original.auto_renew === true"
							:loading="autoRenew.pending.has(row.original.domain_name)"
							:disabled="autoRenew.pending.has(row.original.domain_name)"
							:aria-label="`Auto-renew ${row.original.domain_name}`"
							@update:model-value="(value) => autoRenew.ask(row.original, value, accountId)"
						/>
					</template>

					<template #actions-cell="{ row }">
						<div class="flex justify-end">
							<UDropdownMenu :items="rowActions(row.original)" :content="{ align: 'end' }">
								<UButton
									icon="i-lucide-ellipsis-vertical"
									color="neutral"
									variant="ghost"
									:aria-label="`Actions for ${row.original.domain_name}`"
								/>
							</UDropdownMenu>
						</div>
					</template>
				</AccountResourceTable>

				<div v-if="list.cursor && !list.error" class="flex flex-col items-center gap-3">
					<UAlert
						v-if="list.moreError"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						role="alert"
						title="Couldn’t load more domains"
						:description="list.moreError"
					/>
					<UButton
						label="Load more"
						icon="i-lucide-chevrons-down"
						color="neutral"
						variant="outline"
						:loading="list.loadingMore"
						:disabled="list.loading"
						@click="loadList({ more: true })"
					/>
				</div>
				<p v-else-if="list.loaded && list.items.length" class="text-dimmed text-xs tabular-nums">
					{{ plural(list.items.length, 'domain') }}
				</p>
			</template>

			<USlideover
				v-model:open="detailOpen"
				:title="detailDomain || 'Domain'"
				:description="detail ? statusMeta(detail.status).description : ''"
			>
				<template #body>
					<div class="flex flex-col gap-6">
						<UAlert
							v-if="detailError"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							role="alert"
							title="Couldn’t load the registration"
							:description="detailError"
							:actions="[
								{
									label: 'Try again',
									icon: 'i-lucide-refresh-cw',
									color: 'neutral',
									variant: 'outline',
									loading: detailLoading,
									onClick: loadDetail
								}
							]"
						/>

						<div v-if="detailLoading && !detail" class="flex flex-col gap-3" aria-busy="true">
							<span class="sr-only" role="status">Loading {{ detailDomain }}…</span>
							<USkeleton v-for="row in 5" :key="row" class="h-5 w-full" />
						</div>

						<template v-if="detail">
							<dl class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-sm">
								<dt class="text-muted">Status</dt>
								<dd>
									<UBadge :color="statusMeta(detail.status).color" variant="subtle" size="sm">
										{{ statusMeta(detail.status).label }}
									</UBadge>
								</dd>

								<dt class="text-muted">Registered</dt>
								<dd class="text-default">
									<time v-if="formatDate(detail.created_at)" :datetime="detail.created_at">
										{{ formatDate(detail.created_at, 'datetime') }}
									</time>
									<span v-else class="text-dimmed">Not yet known</span>
								</dd>

								<dt class="text-muted">Expires</dt>
								<dd class="text-default">
									<time
										v-if="formatDate(detail.expires_at)"
										:datetime="detail.expires_at"
										:class="{ 'text-warning': expiresSoon(detail) }"
									>
										{{ formatDate(detail.expires_at, 'datetime') }}
									</time>
									<span v-else class="text-dimmed">Not yet known</span>
								</dd>

								<dt id="registrar-detail-renew" class="text-muted">Auto-renew</dt>
								<dd class="flex items-center gap-2">
									<USwitch
										:model-value="detail.auto_renew === true"
										:loading="autoRenew.pending.has(detail.domain_name)"
										:disabled="autoRenew.pending.has(detail.domain_name)"
										aria-labelledby="registrar-detail-renew"
										@update:model-value="(value) => autoRenew.ask(detail, value, accountId)"
									/>
									<span class="text-default">{{ detail.auto_renew ? 'On' : 'Off' }}</span>
								</dd>

								<dt class="text-muted">Transfer lock</dt>
								<dd class="text-default">{{ detail.locked ? 'Locked' : 'Unlocked' }}</dd>

								<dt class="text-muted">WHOIS privacy</dt>
								<dd class="text-default">
									{{ PRIVACY_LABELS[detail.privacy_mode] || detail.privacy_mode || 'Not set' }}
								</dd>
							</dl>

							<RegistrarWorkflowStatus
								v-for="workflow in detailWorkflows"
								:key="workflow.command"
								:account="accountId"
								:domain="detail.domain_name"
								:command="workflow.command"
								:label="workflow.label"
								:status="workflow.status"
								:poll="workflow.poll"
								@update="(status) => onWorkflowUpdate(workflow, status)"
							/>

							<div class="flex flex-wrap gap-2">
								<UButton
									v-if="zoneIdFor(detail.domain_name)"
									label="Manage DNS records"
									icon="i-lucide-list"
									size="sm"
									color="neutral"
									variant="outline"
									:to="`/zones/${zoneIdFor(detail.domain_name)}/records`"
								/>
								<UButton
									label="Open in the Cloudflare dashboard"
									icon="i-lucide-external-link"
									size="sm"
									color="neutral"
									variant="outline"
									:to="dashboardUrl"
									target="_blank"
								/>
							</div>

							<AccountJsonPanel :value="detail" />
						</template>
					</div>
				</template>
			</USlideover>

			<RegistrarRegisterSlideover
				v-if="accountId"
				v-model:open="registerOpen"
				:account="accountId"
				:account-label="accountName"
				:domain="registerDomain"
				@registered="onRegistered"
			/>

			<RegistrarConfirmModal
				v-model:open="autoRenew.open.value"
				:title="autoRenew.copy.value.title"
				:description="autoRenew.copy.value.description"
				:confirm-label="autoRenew.copy.value.confirm"
				:confirm-icon="autoRenew.target.value?.enable ? 'i-lucide-repeat' : 'i-lucide-circle-off'"
				:confirm-color="autoRenew.target.value?.enable ? 'primary' : 'warning'"
				error-title="Cloudflare didn’t change auto-renew"
				:action="applyAutoRenew"
			>
				<p v-if="autoRenew.copy.value.detail" class="text-muted">{{ autoRenew.copy.value.detail }}</p>
			</RegistrarConfirmModal>
		</template>
	</UDashboardPanel>
</template>

<script setup>
// Cloudflare Registrar for one account: the registered domains with their expiry and
// auto-renew, each domain's details and any workflow in progress, and registering a new domain.
// The account lives in the URL (/registrar?account=<id>), and ?register=<domain> opens the
// registration panel on that domain, as the Domain Search tool links to it.

const STATUS = {
	active: { label: 'Active', color: 'success', description: 'Registered and in use.' },
	registration_pending: {
		label: 'Registering',
		color: 'info',
		description: 'Cloudflare is still registering it with the registry.'
	},
	transfer_pending: {
		label: 'Transferring in',
		color: 'info',
		description: 'It’s moving to Cloudflare from another registrar. Transfers usually take 1 to 10 days.'
	},
	expired: { label: 'Expired', color: 'error', description: 'The registration has expired.' },
	suspended: { label: 'Suspended', color: 'error', description: 'The registry has suspended it.' },
	redemption_period: {
		label: 'Redemption period',
		color: 'warning',
		description: 'It has expired and is in the registry’s redemption grace period.'
	},
	pending_delete: {
		label: 'Pending deletion',
		color: 'error',
		description: 'The registry has scheduled it for deletion.'
	}
}

const PRIVACY_LABELS = { redaction: 'Contact details redacted', off: 'Off' }

// Cloudflare's own sort orders for the list. Expiry soonest first; newest registrations first.
const SORT_ITEMS = [
	{ label: 'Name', value: 'name' },
	{ label: 'Expiry date', value: 'registry_expires_at' },
	{ label: 'Registration date', value: 'registry_created_at' }
]
const SORT_DIRECTIONS = { name: 'asc', registry_expires_at: 'asc', registry_created_at: 'desc' }

const route = useRoute()
const router = useRouter()
const notify = useNotify()
const { exec } = useCfCommands()
const { zones, load: loadZones, findZone } = useZones()
const { accounts, loading: accountsLoading, error: accountsError, load: loadAccounts, findAccount } = useAccounts()

const queryValue = (value) => (typeof value === 'string' ? value : Array.isArray(value) ? value[0] || '' : '')

const accountId = ref(queryValue(route.query.account).trim())
const sortBy = ref('name')

const accountName = computed(() => findAccount(accountId.value)?.name || '')

const accountItems = computed(() => {
	const items = accounts.value.map((account) => ({ label: account.name || account.id, value: account.id }))
	// An account from a link that the list doesn't include, so the picker still shows it.
	if (accountId.value && !items.some((item) => item.value === accountId.value)) {
		items.unshift({ label: accountId.value, value: accountId.value })
	}
	return items
})

const dashboardUrl = computed(
	() => `https://dash.cloudflare.com/${encodeURIComponent(accountId.value)}/domains/registrations`
)

useSeoMeta({ title: computed(() => (accountName.value ? `Registrar · ${accountName.value}` : 'Registrar')) })

// As the console does: the account of the zone the sidebar last showed, or the token's only one.
const defaultAccount = () => {
	const fromZone = findZone(readStorage(STORAGE_KEYS.zoneId))?.account?.id
	if (fromZone && accounts.value.some((account) => account.id === fromZone)) return fromZone
	return accounts.value.length === 1 ? accounts.value[0].id : ''
}

const zoneIds = computed(() => new Map(zones.value.map((zone) => [zone.name.toLowerCase(), zone.id])))
const zoneIdFor = (domain) => zoneIds.value.get(String(domain || '').toLowerCase()) || ''

const statusMeta = (status) =>
	STATUS[status] || {
		label: status || 'Unknown',
		color: 'neutral',
		description: status ? `Cloudflare reports “${status}”.` : ''
	}

const expiryLabel = (registration) => {
	const date = formatDate(registration.expires_at)
	return date ? `Expires ${date}` : 'Expiry not yet known'
}

// --- List ----------------------------------------------------------------------------------------

const FROM_SM = { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' }
const FROM_MD = { th: 'hidden md:table-cell', td: 'hidden md:table-cell' }

const columns = [
	{ accessorKey: 'domain_name', header: 'Domain' },
	{ accessorKey: 'status', header: 'Status', meta: { class: FROM_SM } },
	{ accessorKey: 'expires_at', header: 'Expires', meta: { class: FROM_MD } },
	{ accessorKey: 'auto_renew', header: 'Auto-renew' },
	{
		id: 'actions',
		header: () => h('span', { class: 'sr-only' }, 'Actions'),
		meta: { class: { td: 'w-px text-end' } }
	}
]

const list = reactive({
	items: [],
	cursor: '',
	loading: false,
	loaded: false,
	error: '',
	loadingMore: false,
	moreError: ''
})

let listToken = 0

const resetList = () => {
	listToken++
	Object.assign(list, {
		items: [],
		cursor: '',
		loading: false,
		loaded: false,
		error: '',
		loadingMore: false,
		moreError: ''
	})
}

const mergeByName = (current, page) => {
	const seen = new Set(current.map((item) => item.domain_name))
	return [...current, ...page.filter((item) => !seen.has(item.domain_name))]
}

// The list uses Cloudflare's cursor pagination: each page's result_info.cursor fetches the next,
// and an empty cursor means there are no more.
const loadList = async ({ more = false } = {}) => {
	const account = accountId.value
	if (!account) return
	if (more && (!list.cursor || list.loadingMore)) return
	const token = more ? listToken : ++listToken
	if (more) {
		list.loadingMore = true
		list.moreError = ''
	} else {
		list.loading = true
		list.error = ''
	}
	try {
		const flags = { 'sort-by': sortBy.value, direction: SORT_DIRECTIONS[sortBy.value] }
		if (more) flags.cursor = list.cursor
		const response = await exec(
			'registrar registrations list',
			{ account, flags },
			{ fallback: 'Cloudflare didn’t return the registered domains' }
		)
		if (token !== listToken) return
		const page = (response?.result || []).filter((item) => item?.domain_name)
		list.items = more ? mergeByName(list.items, page) : page
		list.cursor = response?.result_info?.cursor || ''
		list.loaded = true
	} catch (error) {
		if (token !== listToken) return
		const message = describeError(error, 'Cloudflare didn’t return the registered domains')
		if (more) list.moreError = message
		else {
			list.error = message
			list.cursor = ''
			list.loaded = true
		}
	} finally {
		if (token === listToken) {
			if (more) list.loadingMore = false
			else list.loading = false
		}
	}
}

const refreshList = () => loadList()

const replaceItem = (registration) => {
	const index = list.items.findIndex((item) => item.domain_name === registration.domain_name)
	if (index !== -1) list.items.splice(index, 1, registration)
}

const rowActions = (registration) => [
	[
		{ label: 'View details', icon: 'i-lucide-panel-right-open', onSelect: () => openDetail(registration) },
		...(zoneIdFor(registration.domain_name)
			? [
					{
						label: 'Manage DNS records',
						icon: 'i-lucide-list',
						to: `/zones/${zoneIdFor(registration.domain_name)}/records`
					}
				]
			: []),
		{ label: 'Copy domain', icon: 'i-lucide-copy', onSelect: () => notify.copy(registration.domain_name, 'Domain') }
	]
]

// --- Detail --------------------------------------------------------------------------------------

const detailOpen = ref(false)
const detailDomain = ref('')
const detail = ref(null)
const detailLoading = ref(false)
const detailError = ref('')
let detailToken = 0

// Renewal prices quoted when a domain was registered from this page, by domain.
const renewalPrices = reactive(new Map())

const loadDetail = async () => {
	const domain = detailDomain.value
	if (!domain || !accountId.value) return
	const token = ++detailToken
	detailLoading.value = true
	detailError.value = ''
	try {
		const response = await exec(
			'registrar registrations get',
			{ account: accountId.value, args: { 'domain-name': domain } },
			{ fallback: 'Cloudflare didn’t return the registration' }
		)
		if (token !== detailToken) return
		if (response?.result?.domain_name) {
			detail.value = response.result
			replaceItem(response.result)
		}
	} catch (error) {
		if (token !== detailToken) return
		detailError.value = describeError(error, 'Cloudflare didn’t return the registration')
	} finally {
		if (token === detailToken) detailLoading.value = false
	}
}

const openDetail = (registration) => {
	detailDomain.value = registration.domain_name
	detail.value = registration
	detailError.value = ''
	detailOpen.value = true
	loadDetail()
}

// Workflows worth showing for the open domain: its registration or transfer while one is
// pending, and an auto-renew change Cloudflare hadn't finished.
const detailWorkflows = computed(() => {
	const registration = detail.value
	if (!registration) return []
	const workflows = []
	if (registration.status === 'registration_pending') {
		workflows.push({ command: 'registrar registrations get-registration-status', label: 'Registration' })
	}
	if (registration.status === 'transfer_pending') {
		workflows.push({ command: 'registrar registrations get-transfer-status', label: 'Transfer' })
	}
	if (autoRenew.pending.has(registration.domain_name)) {
		workflows.push({
			command: 'registrar registrations get-update-status',
			label: 'Auto-renew change',
			status: autoRenew.pending.get(registration.domain_name),
			poll: true
		})
	}
	return workflows
})

const onWorkflowUpdate = (workflow, status) => {
	if (!isWorkflowFinished(status)) return
	const domain = detail.value?.domain_name
	if (workflow.command.endsWith('get-update-status')) {
		autoRenew.pending.delete(domain)
		if (status.state === 'failed') {
			notify.error('Cloudflare didn’t change auto-renew', status.error?.message || 'The update failed.')
		}
	}
	// The registration's status or auto-renew has changed, so read it again.
	loadDetail()
}

// --- Auto-renew ----------------------------------------------------------------------------------

const autoRenew = useAutoRenew({
	priceNote: (domain) => {
		const price = renewalPrices.get(domain)
		return price
			? `When it was registered here, Cloudflare quoted ${formatMoney(price.renewal_cost, price.currency)} a year to renew. Renewal prices follow the registry and can change.`
			: ''
	},
	onChanged: (updated) => {
		replaceItem(updated)
		if (detail.value?.domain_name === updated.domain_name) detail.value = updated
	},
	pendingHint: 'The domain’s details show the progress.'
})

// Reads the open domain again after a change, including one Cloudflare is still finishing.
const applyAutoRenew = async () => {
	const domain = autoRenew.target.value?.registration.domain_name
	await autoRenew.apply()
	if (detailOpen.value && detailDomain.value === domain) loadDetail()
}

// --- Registering ---------------------------------------------------------------------------------

const registerOpen = ref(false)
const registerDomain = ref('')

const openRegister = (domain) => {
	registerDomain.value = domain
	registerOpen.value = true
}

const onRegistered = ({ domain, pricing }) => {
	if (pricing) renewalPrices.set(domain, pricing)
	refreshList()
}

// --- Account -------------------------------------------------------------------------------------
// Defined before the ?register watcher: when both react to a new account, this one runs first,
// so it doesn't close a panel the other has just opened.

watch(
	() => queryValue(route.query.account).trim(),
	(id) => {
		if (id && id !== accountId.value) accountId.value = id
	}
)

watch(
	accountId,
	(id, previous) => {
		if (queryValue(route.query.account) !== id) {
			const query = { ...route.query }
			if (id) query.account = id
			else delete query.account
			router.replace({ query })
		}
		// Panels opened for one account shouldn't stay open for another.
		if (previous !== undefined) {
			detailOpen.value = false
			registerOpen.value = false
			autoRenew.open.value = false
		}
		autoRenew.pending.clear()
		resetList()
		if (id) loadList()
	},
	{ immediate: true }
)

// ?register=<domain> opens the panel on that domain once there's an account to register it in.
watch(
	[() => queryValue(route.query.register).trim(), accountId],
	([domain, account]) => {
		if (domain && account && !registerOpen.value) openRegister(domain)
	},
	{ immediate: true }
)

watch(registerOpen, (open) => {
	if (open || !route.query.register) return
	const query = { ...route.query }
	delete query.register
	router.replace({ query })
})

watch(sortBy, () => {
	resetList()
	loadList()
})

onMounted(async () => {
	await Promise.all([loadAccounts(), loadZones()])
	if (!accountId.value) accountId.value = defaultAccount()
})
</script>
