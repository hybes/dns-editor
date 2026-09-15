<template>
	<UDashboardPanel id="zone-rules">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span class="shrink-0">Rules</span>
					<span v-if="zoneName" class="text-muted truncate font-normal">· {{ zoneName }}</span>
				</template>

				<template #right>
					<UTooltip v-if="accessState === 'available'" text="Refresh rules">
						<UButton
							icon="i-lucide-refresh-cw"
							color="neutral"
							variant="ghost"
							aria-label="Refresh rules"
							:loading="rulesetsLoading || rulesLoading"
							@click="refresh"
						/>
					</UTooltip>
					<UButton v-if="canAddBypass" icon="i-lucide-plus" aria-label="Add bypass rule" @click="openCreate">
						<span class="hidden sm:inline">Add bypass rule</span>
					</UButton>
				</template>
			</UDashboardNavbar>

			<UDashboardToolbar v-if="accessState === 'available'">
				<template #left>
					<UFormField label="Phase" orientation="horizontal" class="items-center">
						<USelect v-model="selectedPhase" :items="phaseItems" class="w-64" />
					</UFormField>
					<UFormField
						v-if="phaseRulesets.length > 1"
						label="Ruleset"
						orientation="horizontal"
						class="ms-4 items-center"
					>
						<USelect v-model="rulesetModel" :items="rulesetItems" class="w-56" />
					</UFormField>
				</template>
			</UDashboardToolbar>
		</template>

		<template #body>
			<AccountFeatureGate
				:loaded="accessState !== 'loading'"
				:available="accessState === 'available'"
				feature="rules"
				:reason="accessReason"
				hint="Use a token that can read and edit this zone’s rules."
				:checking="checkingAccess"
				@retry="retryAccess"
			>
				<UAlert
					v-if="rulesetsError"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					title="Couldn’t load rulesets"
					:description="rulesetsError"
					:actions="[
						{
							label: 'Try again',
							icon: 'i-lucide-refresh-cw',
							color: 'neutral',
							variant: 'outline',
							loading: rulesetsLoading,
							onClick: refresh
						}
					]"
				/>

				<div v-if="!rulesetsLoaded && !rulesetsError" class="flex flex-col gap-3" aria-busy="true">
					<span class="sr-only">Loading rulesets</span>
					<USkeleton v-for="n in 5" :key="n" class="h-12 w-full" />
				</div>

				<template v-else-if="rulesetsLoaded && !selectedRuleset">
					<UAlert
						v-if="entrypointError"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						title="Couldn’t create the entry point ruleset"
						:description="entrypointError"
					/>
					<UEmpty
						icon="i-lucide-list-plus"
						:title="`No entry point ruleset for ${phaseLabel}`"
						:description="`Each phase keeps a zone’s rules in an entry point ruleset, and ${zoneName || 'this zone'} doesn’t have one for ${phaseLabel} yet. Create it to start adding rules.`"
						:actions="
							entrypointCreatable
								? [
										{
											label: 'Create entry point ruleset',
											icon: 'i-lucide-plus',
											loading: creatingEntrypoint,
											onClick: createEntrypoint
										}
									]
								: undefined
						"
					/>
				</template>

				<template v-else-if="selectedRuleset">
					<UAlert
						v-if="rulesError"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						title="Couldn’t load the rules"
						:description="rulesError"
						:actions="[
							{
								label: 'Try again',
								icon: 'i-lucide-refresh-cw',
								color: 'neutral',
								variant: 'outline',
								loading: rulesLoading,
								onClick: loadRules
							}
						]"
					/>

					<UTable
						v-if="ruleset || !rulesError"
						:data="rules"
						:columns="columns"
						:loading="rulesLoading"
						:caption="`Rules in ${phaseLabel}`"
						class="shrink-0"
						:ui="{ th: 'py-3', td: 'py-3 align-top' }"
					>
						<template #loading>
							<div class="flex flex-col gap-3 px-4 text-start">
								<span class="sr-only">Loading rules</span>
								<USkeleton v-for="n in 4" :key="n" class="h-6 w-full" />
							</div>
						</template>

						<template #empty>
							<UEmpty
								variant="naked"
								icon="i-lucide-list"
								title="No rules in this phase yet"
								:description="
									bypassSupported
										? 'Add a bypass rule so requests that send a secret token skip the checks you choose.'
										: 'This page can add bypass rules to Custom rules (WAF) and Managed rules. Other rules are created in the Cloudflare dashboard.'
								"
								:actions="
									bypassSupported
										? [{ label: 'Add bypass rule', icon: 'i-lucide-plus', onClick: openCreate }]
										: undefined
								"
							/>
						</template>

						<template #enabled-cell="{ row }">
							<USwitch
								:model-value="row.original.enabled !== false"
								:loading="Boolean(toggling[row.original.id])"
								:disabled="Boolean(toggling[row.original.id])"
								:aria-label="`Enabled: ${ruleLabel(row.original)}`"
								size="sm"
								@update:model-value="(value) => setEnabled(row.original, value)"
							/>
						</template>

						<template #action-cell="{ row }">
							<UBadge
								:label="actionLabel(row.original.action)"
								:color="actionColor(row.original.action)"
								variant="subtle"
							/>
						</template>

						<template #description-cell="{ row }">
							<span
								v-if="row.original.description"
								class="text-highlighted block max-w-xs min-w-40 whitespace-normal"
							>
								{{ row.original.description }}
							</span>
							<span v-else class="text-dimmed">No description</span>
						</template>

						<template #expression-cell="{ row }">
							<div class="flex max-w-xl min-w-64 items-start gap-1">
								<code
									class="text-default flex-1 font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap"
									>{{ displayExpression(row.original) }}</code
								>
								<UButton
									v-if="hasToken(row.original.expression)"
									:icon="revealed[row.original.id] ? 'i-lucide-eye-off' : 'i-lucide-eye'"
									:aria-label="`${revealed[row.original.id] ? 'Hide' : 'Show'} token in ${ruleLabel(row.original)}`"
									size="xs"
									color="neutral"
									variant="ghost"
									@click="toggleReveal(row.original.id)"
								/>
							</div>
						</template>

						<template #logging-cell="{ row }">
							<span v-if="row.original.logging?.enabled === true" class="text-default">On</span>
							<span v-else-if="row.original.logging?.enabled === false">Off</span>
							<span v-else class="text-dimmed">
								<span aria-hidden="true">—</span>
								<span class="sr-only">Not set</span>
							</span>
						</template>

						<template #updated-cell="{ row }">
							<time v-if="row.original.last_updated" :datetime="row.original.last_updated">
								{{ formatDate(row.original.last_updated, 'datetime') }}
							</time>
						</template>

						<template #actions-header>
							<span class="sr-only">Actions</span>
						</template>

						<template #actions-cell="{ row }">
							<div class="flex justify-end">
								<UDropdownMenu :items="rowMenu(row.original)" :content="{ align: 'end' }">
									<UButton
										icon="i-lucide-ellipsis-vertical"
										color="neutral"
										variant="ghost"
										:aria-label="`Actions for ${ruleLabel(row.original)}`"
									/>
								</UDropdownMenu>
							</div>
						</template>
					</UTable>
				</template>
			</AccountFeatureGate>

			<UModal
				v-model:open="deleteOpen"
				title="Delete rule"
				:dismissible="!deleting"
				:close="{ disabled: deleting }"
			>
				<template #body>
					<div class="flex flex-col gap-4 text-sm">
						<p class="text-default">
							Delete
							<strong class="text-highlighted">{{ ruleLabel(deleteTarget) }}</strong>
							from {{ phaseLabel }} on {{ zoneName || 'this zone' }}? This can’t be undone.
						</p>
						<p v-if="deleteTarget && hasToken(deleteTarget.expression)" class="text-muted">
							Requests that send its bypass token will no longer skip any checks.
						</p>
						<UAlert
							v-if="deleteError"
							role="alert"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							title="Couldn’t delete the rule"
							:description="deleteError"
						/>
					</div>
				</template>

				<template #footer>
					<div class="flex w-full justify-end gap-2">
						<UButton
							label="Cancel"
							color="neutral"
							variant="outline"
							:disabled="deleting"
							@click="deleteOpen = false"
						/>
						<UButton
							label="Delete rule"
							icon="i-lucide-trash-2"
							color="error"
							:loading="deleting"
							@click="confirmDelete"
						/>
					</div>
				</template>
			</UModal>

			<USlideover
				v-model:open="createOpen"
				title="Add bypass rule"
				:description="`Requests that send this token skip the checks you choose in ${phaseLabel}.`"
				:dismissible="!creating"
				:close="{ disabled: creating }"
				:ui="{ footer: 'flex-col items-stretch gap-3' }"
			>
				<template #body>
					<form id="bypass-rule-form" class="flex flex-col gap-6" novalidate @submit.prevent="submitCreate">
						<UFormField
							label="Description"
							name="description"
							hint="Optional"
							help="Shown in the rules list here and in the Cloudflare dashboard."
						>
							<UInput v-model="form.description" class="w-full" autocomplete="off" />
						</UFormField>

						<UFormField
							label="Bypass token"
							name="token"
							required
							:error="tokenError"
							help="8–256 letters, numbers, hyphens or underscores. Anyone with this token skips the checks below, so keep it secret."
						>
							<div class="flex gap-2">
								<UInput
									v-model="form.token"
									class="min-w-0 flex-1"
									:ui="{ base: 'font-mono text-xs' }"
									autocomplete="off"
									spellcheck="false"
									@blur="tokenTouched = true"
								/>
								<UTooltip text="Generate a new token">
									<UButton
										icon="i-lucide-refresh-cw"
										color="neutral"
										variant="outline"
										aria-label="Generate a new token"
										@click="generateToken"
									/>
								</UTooltip>
								<UTooltip text="Copy token">
									<UButton
										icon="i-lucide-copy"
										color="neutral"
										variant="outline"
										aria-label="Copy token"
										:disabled="!tokenValue"
										@click="notify.copy(tokenValue, 'Token')"
									/>
								</UTooltip>
							</div>
						</UFormField>

						<div class="flex flex-col gap-4">
							<USwitch
								v-model="form.enabled"
								label="Enabled"
								description="Turn off to save the rule without applying it yet."
							/>
							<USwitch
								v-model="form.logging"
								label="Log matching requests"
								description="Requests that use the token appear in Security Events."
							/>
						</div>

						<fieldset class="flex flex-col gap-4">
							<legend class="text-default mb-3 text-sm font-medium">What to skip</legend>
							<UCheckbox
								v-model="form.skipRuleset"
								label="The rest of this ruleset"
								:description="skipRulesetDescription"
							/>
							<UCheckboxGroup
								v-if="skipPhaseItems.length"
								v-model="form.phases"
								legend="Other phases"
								:items="skipPhaseItems"
							/>
							<UCheckboxGroup
								v-if="skipProductItems.length"
								v-model="form.products"
								legend="Other security features"
								:items="skipProductItems"
							/>
							<p v-if="skipError" class="text-error text-sm" role="alert">{{ skipError }}</p>
						</fieldset>

						<UFormField
							label="Expression"
							name="expression"
							help="The rule is added at the top of the ruleset, so it runs before the rules it skips."
						>
							<div class="flex items-start gap-2">
								<UTextarea
									:model-value="expressionPreview"
									readonly
									autoresize
									:rows="2"
									placeholder="Enter a valid token to see the expression."
									class="min-w-0 flex-1"
									:ui="{ base: 'font-mono text-xs' }"
								/>
								<UTooltip text="Copy expression">
									<UButton
										icon="i-lucide-copy"
										color="neutral"
										variant="outline"
										aria-label="Copy expression"
										:disabled="!expressionPreview"
										@click="notify.copy(expressionPreview, 'Expression')"
									/>
								</UTooltip>
							</div>
						</UFormField>

						<div class="flex flex-col gap-2 text-sm">
							<p class="text-default font-medium">Using the token</p>
							<p class="text-muted">
								Send it in an <code class="font-mono text-xs">x-cf-bypass-token</code> request header,
								for example:
							</p>
							<code
								class="bg-muted text-default block rounded-md px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]"
								>curl -H "x-cf-bypass-token: &lt;token&gt;" https://{{
									zoneName || 'example.com'
								}}/</code
							>
						</div>
					</form>
				</template>

				<template #footer>
					<UAlert
						v-if="createError"
						role="alert"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						title="Couldn’t add the rule"
						:description="createError"
					/>
					<div class="flex w-full justify-end gap-2">
						<UButton
							label="Cancel"
							color="neutral"
							variant="outline"
							:disabled="creating"
							@click="createOpen = false"
						/>
						<UButton
							type="submit"
							form="bypass-rule-form"
							label="Add bypass rule"
							icon="i-lucide-plus"
							:loading="creating"
						/>
					</div>
				</template>
			</USlideover>
		</template>
	</UDashboardPanel>
</template>

<script setup>
// Zone phases offered in the phase list, most-used security phases first.
const PHASES = [
	{ value: 'http_request_firewall_custom', label: 'Custom rules (WAF)' },
	{ value: 'http_ratelimit', label: 'Rate limiting rules' },
	{ value: 'http_request_firewall_managed', label: 'Managed rules' },
	{ value: 'http_request_transform', label: 'Transform rules: URL rewrite' },
	{ value: 'http_request_late_transform', label: 'Transform rules: request headers' },
	{ value: 'http_response_headers_transform', label: 'Transform rules: response headers' },
	{ value: 'http_request_dynamic_redirect', label: 'Redirect rules' },
	{ value: 'http_request_origin', label: 'Origin rules' },
	{ value: 'http_config_settings', label: 'Configuration rules' },
	{ value: 'http_request_cache_settings', label: 'Cache rules' },
	{ value: 'http_response_compression', label: 'Compression rules' },
	{ value: 'http_custom_errors', label: 'Custom error rules' }
]

// Labels for phases that only appear when the zone already has a ruleset in them.
const OTHER_PHASE_LABELS = {
	http_request_sbfm: 'Super Bot Fight Mode',
	http_request_sanitize: 'URL normalisation',
	http_log_custom_fields: 'Logpush custom fields',
	http_request_snippets: 'Snippets',
	http_request_cloud_connector: 'Cloud Connector',
	http_response_firewall_managed: 'Sensitive data detection',
	ddos_l7: 'HTTP DDoS protection'
}

const DEFAULT_PHASE = 'http_request_firewall_custom'

// Skip options Cloudflare accepts in each phase; the server checks the same lists.
const SKIP_OPTIONS = {
	http_request_firewall_custom: {
		rulesetDescription: 'Custom rules placed after this one.',
		phases: [
			{ value: 'http_ratelimit', label: 'Rate limiting rules' },
			{ value: 'http_request_sbfm', label: 'Super Bot Fight Mode rules' },
			{ value: 'http_request_firewall_managed', label: 'Managed rules' }
		],
		products: [
			{ value: 'zoneLockdown', label: 'Zone Lockdown' },
			{ value: 'uaBlock', label: 'User Agent Blocking' },
			{ value: 'bic', label: 'Browser Integrity Check' },
			{ value: 'hot', label: 'Hotlink Protection' },
			{ value: 'securityLevel', label: 'Security Level' },
			{ value: 'rateLimit', label: 'Rate limiting rules (previous version)' },
			{ value: 'waf', label: 'Managed rules (previous version)' }
		]
	},
	http_request_firewall_managed: {
		rulesetDescription: 'Managed rulesets deployed after this rule.',
		phases: [],
		products: []
	}
}

const ACTION_LABELS = {
	block: 'Block',
	challenge: 'Interactive challenge',
	js_challenge: 'Non-interactive challenge',
	managed_challenge: 'Managed challenge',
	log: 'Log',
	skip: 'Skip',
	execute: 'Execute',
	rewrite: 'Rewrite',
	redirect: 'Redirect',
	route: 'Route',
	set_config: 'Set configuration',
	set_cache_settings: 'Cache settings',
	compress_response: 'Compress response',
	serve_error: 'Serve error',
	score: 'Score',
	log_custom_field: 'Log custom field'
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,256}$/
const TOKEN_IN_EXPRESSION = /(http\.request\.headers\["x-cf-bypass-token"\]\[\*\]\s+(?:eq|==)\s+")((?:[^"\\]|\\.)*)(")/g
const TOKEN_MASK = '••••••••'

const route = useRoute()
const { call } = useCfApi()
const notify = useNotify()
const {
	zoneId,
	zoneName,
	capabilities,
	capabilitiesLoaded,
	missingCapabilities,
	can,
	load: loadZone
} = useZone(() => route.params.zone_id)

useSeoMeta({ title: computed(() => (zoneName.value ? `Rules · ${zoneName.value}` : 'Rules')) })

// Access -----------------------------------------------------------------------------------

const checkingAccess = ref(false)
const accessChecked = ref(false)

const accessState = computed(() => {
	if (can('rulesets')) return 'available'
	if (capabilitiesLoaded.value) return capabilities.value ? 'unavailable' : 'failed'
	return accessChecked.value && !checkingAccess.value ? 'failed' : 'loading'
})

const accessReason = computed(() => missingCapabilities.value.find((item) => item.key === 'rulesets')?.reason || '')

const checkAccess = async ({ force = false } = {}) => {
	checkingAccess.value = true
	try {
		await loadZone({ force })
		// Zone details can still be cached after the feature check failed, in which case
		// load() returns early without checking again.
		if (!force && !capabilitiesLoaded.value) await loadZone({ force: true })
	} finally {
		checkingAccess.value = false
		accessChecked.value = true
	}
}

const retryAccess = () => checkAccess({ force: true })

// Rulesets and rules -----------------------------------------------------------------------

const rulesets = ref([])
const rulesetsLoading = ref(false)
const rulesetsLoaded = ref(false)
const rulesetsError = ref('')
let rulesetsRequest = 0

const selectedPhase = ref(DEFAULT_PHASE)
const selectedRulesetId = ref('')
const ruleset = ref(null)
const rulesLoading = ref(false)
const rulesError = ref('')
let rulesRequest = 0

const revealed = ref({})
const creatingEntrypoint = ref(false)
const entrypointError = ref('')

const phaseName = (phase) =>
	PHASES.find((item) => item.value === phase)?.label || OTHER_PHASE_LABELS[phase] || phase || 'this phase'

const phaseLabel = computed(() => phaseName(selectedPhase.value))

// Only zone entry points can be changed through the zone API; managed rulesets are Cloudflare's.
const zoneRulesets = computed(() => rulesets.value.filter((item) => item?.kind === 'zone'))
const phaseRulesets = computed(() => zoneRulesets.value.filter((item) => item.phase === selectedPhase.value))
const selectedRuleset = computed(() => phaseRulesets.value.find((item) => item.id === selectedRulesetId.value) || null)
const rules = computed(() => (ruleset.value?.id === selectedRulesetId.value ? ruleset.value.rules || [] : []))

const phaseItems = computed(() => {
	const known = new Set(PHASES.map((item) => item.value))
	const extra = [...new Set(zoneRulesets.value.map((item) => item.phase))]
		.filter((phase) => phase && !known.has(phase))
		.map((phase) => ({ value: phase, label: phaseName(phase) }))
	return [...PHASES, ...extra]
})

const rulesetItems = computed(() =>
	phaseRulesets.value.map((item) => ({ value: item.id, label: item.name || item.id }))
)

const entrypointCreatable = computed(() => PHASES.some((item) => item.value === selectedPhase.value))

const loadRulesets = async () => {
	const request = ++rulesetsRequest
	rulesetsLoading.value = true
	rulesetsError.value = ''
	try {
		const response = await call('rulesets', { currZone: zoneId.value }, { fallback: 'Couldn’t load rulesets' })
		if (request !== rulesetsRequest) return false
		rulesets.value = Array.isArray(response.result) ? response.result : []
		rulesetsLoaded.value = true
		return true
	} catch (error) {
		if (request === rulesetsRequest) rulesetsError.value = describeError(error, 'Couldn’t load rulesets')
		return false
	} finally {
		if (request === rulesetsRequest) rulesetsLoading.value = false
	}
}

const loadRules = async () => {
	const rulesetId = selectedRulesetId.value
	if (!rulesetId) return
	const request = ++rulesRequest
	rulesLoading.value = true
	rulesError.value = ''
	try {
		const response = await call(
			'ruleset',
			{ currZone: zoneId.value, rulesetId },
			{ fallback: 'Couldn’t load the rules' }
		)
		if (request === rulesRequest) ruleset.value = response.result || null
	} catch (error) {
		if (request === rulesRequest) rulesError.value = describeError(error, 'Couldn’t load the rules')
	} finally {
		if (request === rulesRequest) rulesLoading.value = false
	}
}

// Rule changes answer with the whole updated ruleset, so the table is refreshed from that
// answer rather than with another request.
const applyRuleset = (rulesetId, result) => {
	if (selectedRulesetId.value !== rulesetId) return
	if (result?.id === rulesetId) {
		rulesRequest++
		rulesLoading.value = false
		rulesError.value = ''
		ruleset.value = result
	} else {
		loadRules()
	}
}

const selectRuleset = (id, { force = false, data = null } = {}) => {
	const changed = id !== selectedRulesetId.value
	selectedRulesetId.value = id
	if (changed) {
		rulesRequest++
		ruleset.value = null
		rulesError.value = ''
		rulesLoading.value = false
		revealed.value = {}
	}
	if (!id) return
	if (data) applyRuleset(id, data)
	else if (changed || force) loadRules()
}

// Keeps the chosen ruleset when it still exists in this phase, otherwise picks the first.
const reconcileSelection = ({ force = false } = {}) => {
	const options = phaseRulesets.value
	const keep = options.some((item) => item.id === selectedRulesetId.value)
	selectRuleset(keep ? selectedRulesetId.value : options[0]?.id || '', { force })
}

const rulesetModel = computed({
	get: () => selectedRulesetId.value,
	set: (id) => selectRuleset(id)
})

const refresh = async () => {
	if (rulesetsLoading.value) return
	if (await loadRulesets()) reconcileSelection({ force: true })
}

watch(selectedPhase, () => {
	entrypointError.value = ''
	selectRuleset('')
	reconcileSelection()
})

watch(
	zoneId,
	() => {
		rulesetsRequest++
		rulesets.value = []
		rulesetsLoaded.value = false
		rulesetsLoading.value = false
		rulesetsError.value = ''
		accessChecked.value = false
		selectRuleset('')
		checkAccess()
	},
	{ immediate: true }
)

watch(
	[zoneId, accessState],
	async ([, state]) => {
		if (state !== 'available' || rulesetsLoaded.value || rulesetsLoading.value) return
		if (await loadRulesets()) reconcileSelection()
	},
	{ immediate: true }
)

// Entry point ------------------------------------------------------------------------------

const createEntrypoint = async () => {
	const phase = selectedPhase.value
	creatingEntrypoint.value = true
	entrypointError.value = ''
	try {
		const response = await call(
			'create_entrypoint',
			{ currZone: zoneId.value, phase },
			{ fallback: 'Cloudflare didn’t create the ruleset' }
		)
		const created = response.result
		notify.success('Entry point ruleset created', `${phaseName(phase)} on ${zoneName.value || 'this zone'}`)
		if (!created?.id) {
			await refresh()
			return
		}
		rulesets.value = [...rulesets.value.filter((item) => item.id !== created.id), created]
		if (selectedPhase.value === phase) selectRuleset(created.id, { data: created })
	} catch (error) {
		entrypointError.value = describeError(error, 'Cloudflare didn’t create the ruleset')
	} finally {
		creatingEntrypoint.value = false
	}
}

// Table ------------------------------------------------------------------------------------

const columns = [
	{ id: 'enabled', header: 'Enabled' },
	{ id: 'action', header: 'Action' },
	{ id: 'description', header: 'Description' },
	{ id: 'expression', header: 'Expression' },
	{ id: 'logging', header: 'Logging' },
	{ id: 'updated', header: 'Last updated' },
	{ id: 'actions', header: '' }
]

const ruleLabel = (rule) => {
	if (!rule) return 'this rule'
	return rule.description || `untitled rule ${String(rule.id || '').slice(0, 8)}`
}

const actionLabel = (action) => ACTION_LABELS[action] || String(action || 'Unknown').replaceAll('_', ' ')

const actionColor = (action) => {
	if (action === 'block') return 'error'
	if (String(action).includes('challenge')) return 'warning'
	if (action === 'skip') return 'info'
	return 'neutral'
}

const maskTokens = (expression) =>
	String(expression || '').replace(TOKEN_IN_EXPRESSION, (_match, start, _token, end) => `${start}${TOKEN_MASK}${end}`)

const hasToken = (expression) => Boolean(expression) && maskTokens(expression) !== expression

const toggleReveal = (id) => {
	revealed.value = { ...revealed.value, [id]: !revealed.value[id] }
}

const displayExpression = (rule) => (revealed.value[rule.id] ? rule.expression || '' : maskTokens(rule.expression))

const toggling = ref({})

const setEnabled = async (rule, enabled) => {
	const rulesetId = selectedRulesetId.value
	if (!rulesetId || toggling.value[rule.id]) return
	toggling.value = { ...toggling.value, [rule.id]: true }
	try {
		const response = await call(
			'update_rule',
			{ currZone: zoneId.value, rulesetId, ruleId: rule.id, enabled },
			{ fallback: 'Cloudflare rejected the change' }
		)
		applyRuleset(rulesetId, response.result)
	} catch (error) {
		notify.error(
			enabled ? `Couldn’t turn on ${ruleLabel(rule)}` : `Couldn’t turn off ${ruleLabel(rule)}`,
			error,
			'Cloudflare rejected the change'
		)
	} finally {
		const { [rule.id]: _done, ...rest } = toggling.value
		toggling.value = rest
	}
}

const rowMenu = (rule) => [
	[
		{
			label: 'Copy expression',
			icon: 'i-lucide-copy',
			disabled: !rule.expression,
			onSelect: () => notify.copy(rule.expression, 'Expression')
		}
	],
	[{ label: 'Delete rule', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => askDelete(rule) }]
]

// Delete -----------------------------------------------------------------------------------

const deleteOpen = ref(false)
const deleteTarget = ref(null)
const deleting = ref(false)
const deleteError = ref('')

const askDelete = (rule) => {
	deleteTarget.value = rule
	deleteError.value = ''
	deleteOpen.value = true
}

const confirmDelete = async () => {
	const rule = deleteTarget.value
	const rulesetId = selectedRulesetId.value
	if (!rule || !rulesetId || deleting.value) return
	deleting.value = true
	deleteError.value = ''
	try {
		const response = await call(
			'delete_rule',
			{ currZone: zoneId.value, rulesetId, ruleId: rule.id },
			{ fallback: 'Cloudflare didn’t delete the rule' }
		)
		applyRuleset(rulesetId, response.result)
		deleteOpen.value = false
		notify.success('Rule deleted', `Removed ${ruleLabel(rule)} from ${phaseLabel.value}.`)
	} catch (error) {
		deleteError.value = describeError(error, 'Cloudflare didn’t delete the rule')
	} finally {
		deleting.value = false
	}
}

// Add bypass rule --------------------------------------------------------------------------

const createOpen = ref(false)
const creating = ref(false)
const createError = ref('')
const tokenTouched = ref(false)
const submitted = ref(false)

const form = reactive({
	description: '',
	token: '',
	enabled: true,
	logging: true,
	skipRuleset: true,
	phases: [],
	products: []
})

const skipOptions = computed(() => SKIP_OPTIONS[selectedPhase.value] || null)
const bypassSupported = computed(() => Boolean(skipOptions.value))
const canAddBypass = computed(
	() => accessState.value === 'available' && bypassSupported.value && !!selectedRuleset.value
)
const skipRulesetDescription = computed(() => skipOptions.value?.rulesetDescription || '')
const skipPhaseItems = computed(() => skipOptions.value?.phases || [])
const skipProductItems = computed(() => skipOptions.value?.products || [])

const tokenValue = computed(() => form.token.trim())
const tokenValid = computed(() => TOKEN_PATTERN.test(tokenValue.value))

const tokenError = computed(() => {
	if (!tokenTouched.value && !submitted.value) return false
	const value = tokenValue.value
	if (!value) return 'Enter a token or generate one.'
	if (value.length < 8) return 'Use at least 8 characters.'
	if (value.length > 256) return 'Use 256 characters or fewer.'
	if (!tokenValid.value) return 'Use only letters, numbers, hyphens and underscores.'
	return false
})

const chosenPhases = computed(() => form.phases.filter((value) => skipPhaseItems.value.some((i) => i.value === value)))
const chosenProducts = computed(() =>
	form.products.filter((value) => skipProductItems.value.some((i) => i.value === value))
)
const hasSkipChoice = computed(
	() => form.skipRuleset || chosenPhases.value.length > 0 || chosenProducts.value.length > 0
)
const skipError = computed(() => (submitted.value && !hasSkipChoice.value ? 'Choose at least one thing to skip.' : ''))

const expressionPreview = computed(() =>
	tokenValid.value ? `(any(http.request.headers["x-cf-bypass-token"][*] eq "${tokenValue.value}"))` : ''
)

// 32 random bytes as 64 hex characters. getRandomValues works on plain-HTTP deployments too.
const generateToken = () => {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	form.token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
	tokenTouched.value = true
}

const openCreate = () => {
	if (!canAddBypass.value) return
	Object.assign(form, {
		description: '',
		token: '',
		enabled: true,
		logging: true,
		skipRuleset: true,
		phases: [],
		products: []
	})
	generateToken()
	tokenTouched.value = false
	submitted.value = false
	createError.value = ''
	createOpen.value = true
}

const submitCreate = async () => {
	submitted.value = true
	const target = selectedRuleset.value
	if (creating.value || !target || !tokenValid.value || !hasSkipChoice.value) return
	const phase = selectedPhase.value
	creating.value = true
	createError.value = ''
	try {
		const response = await call(
			'create_skip_rule',
			{
				currZone: zoneId.value,
				rulesetId: target.id,
				phase,
				bypassToken: tokenValue.value,
				description: form.description.trim(),
				enabled: form.enabled,
				loggingEnabled: form.logging,
				actionParameters: {
					ruleset: form.skipRuleset ? 'current' : undefined,
					phases: chosenPhases.value,
					products: chosenProducts.value
				}
			},
			{ fallback: 'Cloudflare didn’t add the rule' }
		)
		applyRuleset(target.id, response.result)
		createOpen.value = false
		notify.success('Bypass rule added', `Added to ${phaseName(phase)} on ${zoneName.value || 'this zone'}.`)
	} catch (error) {
		createError.value = describeError(error, 'Cloudflare didn’t add the rule')
	} finally {
		creating.value = false
	}
}
</script>
