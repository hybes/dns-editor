<template>
	<PageContainer>
		<div class="mb-6 flex flex-wrap items-center justify-center gap-3 sm:justify-between">
			<UButton variant="outline" icon="i-clarity-undo-line" :to="`/zones/${zoneId}/records`">
				Back to Records
			</UButton>
		</div>

		<div class="flex flex-col items-center justify-center gap-6">
			<div class="flex w-full flex-col gap-4">
				<div class="flex flex-col items-center justify-center gap-2">
					<h1 class="text-center text-2xl font-semibold text-stone-900 dark:text-stone-100">
						{{ zoneName }}
					</h1>
					<CapabilityIndicator :missing-items="capabilityMissing" />
					<p class="text-sm text-stone-600 dark:text-stone-400">
						View rulesets rules by phase and add bypass-token skip rules
					</p>
				</div>

				<div
					v-if="canRulesets"
					class="flex w-full flex-wrap gap-4 rounded-lg border border-stone-300 p-4 dark:border-stone-700"
				>
					<div class="flex min-w-[220px] flex-col gap-1">
						<span class="text-sm font-medium text-stone-700 dark:text-stone-200">Phase</span>
						<USelect v-model="selectedPhase" :items="phaseOptions" class="w-full" aria-label="Phase" />
					</div>

					<div class="flex min-w-[280px] flex-1 flex-col gap-1">
						<span class="text-sm font-medium text-stone-700 dark:text-stone-200">Ruleset</span>
						<USelectMenu
							v-model="selectedRulesetId"
							:items="rulesetOptions"
							value-key="value"
							label-key="label"
							placeholder="Select a ruleset"
							class="w-full"
							aria-label="Ruleset"
						/>
					</div>

					<div class="flex items-end">
						<UButton
							variant="outline"
							color="primary"
							icon="i-heroicons-arrow-path"
							:loading="loadingRulesets"
							@click="refreshRulesets"
						>
							Refresh
						</UButton>
					</div>
				</div>

				<div v-if="canRulesets" class="w-full rounded-lg border border-stone-300 dark:border-stone-700">
					<UTable :data="rulesRows" :columns="rulesColumns" :loading="loadingRules" />
				</div>

				<div
					v-if="canRulesets"
					class="w-full max-w-7xl rounded-xl border border-stone-300 p-6 shadow-xs dark:border-stone-700"
				>
					<h2 class="mb-4 text-lg font-semibold text-stone-900 dark:text-stone-100">
						Add bypass-token skip rule
					</h2>

					<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div class="flex flex-col gap-1">
							<span class="text-sm font-medium text-stone-700 dark:text-stone-200">Bypass token</span>
							<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
								<UInput
									v-model="bypassToken"
									placeholder="Token value"
									class="flex-1"
									aria-label="Bypass token"
								/>
								<div class="flex gap-2">
									<UButton
										variant="outline"
										color="primary"
										icon="i-heroicons-key"
										@click="generateToken"
									>
										Generate token
									</UButton>
									<UButton
										variant="outline"
										color="neutral"
										icon="i-clarity-clipboard-line"
										:disabled="!bypassToken"
										@click="copyToken"
									>
										Copy token
									</UButton>
								</div>
							</div>
						</div>

						<div class="flex flex-col gap-1">
							<span class="text-sm font-medium text-stone-700 dark:text-stone-200">Description</span>
							<UInput v-model="description" placeholder="Allow Rules" aria-label="Description" />
						</div>
					</div>

					<div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
						<div class="flex flex-col gap-2">
							<div class="flex items-center justify-between">
								<span class="text-sm font-medium text-stone-700 dark:text-stone-200"
									>Skip current ruleset</span
								>
								<USwitch v-model="skipCurrentRuleset" aria-label="Skip current ruleset" />
							</div>

							<div class="flex flex-col gap-1">
								<span class="text-sm font-medium text-stone-700 dark:text-stone-200">Skip phases</span>
								<USelectMenu
									v-model="skipPhases"
									:items="phaseOptions"
									multiple
									placeholder="Select phases"
									aria-label="Skip phases"
								/>
							</div>

							<div class="flex flex-col gap-1">
								<span class="text-sm font-medium text-stone-700 dark:text-stone-200"
									>Skip products</span
								>
								<USelectMenu
									v-model="skipProducts"
									:items="productOptions"
									multiple
									placeholder="Select products"
									aria-label="Skip products"
								/>
							</div>
						</div>

						<div class="flex flex-col gap-2">
							<div class="flex items-center justify-between">
								<span class="text-sm font-medium text-stone-700 dark:text-stone-200">Enabled</span>
								<USwitch v-model="enabled" aria-label="Enabled" />
							</div>

							<div class="flex items-center justify-between">
								<span class="text-sm font-medium text-stone-700 dark:text-stone-200">Logging</span>
								<USwitch v-model="loggingEnabled" aria-label="Logging" />
							</div>

							<div class="flex flex-col gap-1">
								<span class="text-sm font-medium text-stone-700 dark:text-stone-200"
									>Expression preview</span
								>
								<UInput :model-value="expressionPreview" disabled />
							</div>
						</div>
					</div>

					<div class="mt-6 flex flex-wrap gap-3">
						<UButton
							color="success"
							variant="outline"
							icon="i-clarity-plus-circle-solid"
							:disabled="!canSubmit"
							:loading="creating"
							@click="createRule"
						>
							Add Rule
						</UButton>
						<UButton
							variant="outline"
							color="neutral"
							icon="i-clarity-clipboard-line"
							:disabled="!expressionPreview"
							@click="copyExpression"
						>
							Copy expression
						</UButton>
					</div>

					<div v-if="!selectedRulesetId" class="mt-4 text-sm text-stone-600 dark:text-stone-400">
						Select a ruleset to enable rule creation.
					</div>
				</div>
				<div v-else class="w-full max-w-7xl rounded-xl border border-stone-300 p-6 dark:border-stone-700">
					<div class="text-sm text-stone-700 dark:text-stone-200">
						Rulesets are unavailable for this token/zone.
					</div>
				</div>
			</div>
		</div>
	</PageContainer>
</template>

<script setup>
const route = useRoute()
const { getApiKey } = useSession()
const toast = useToast()

const zoneId = computed(() => route.params.zone_id)
const apiKey = ref('')
const zoneName = ref('')
const capabilities = ref(null)
const capabilityMissing = ref([])
const canRulesets = computed(() =>
	Boolean(capabilities.value && capabilities.value.rulesets && capabilities.value.rulesets.available)
)

const seoZoneLabel = computed(() => zoneName.value || zoneId.value || 'Zone')
useDynamicSeo({
	title: computed(() => `Rules — ${seoZoneLabel.value}`),
	description: computed(() => `View and manage rules for ${seoZoneLabel.value}.`)
})

const phaseOptions = [
	'http_ratelimit',
	'http_request_firewall_custom',
	'http_request_firewall_managed',
	'http_request_sbfm',
	'http_request_late_transform',
	'http_request_sanitize',
	'http_request_transform',
	'http_response_compression',
	'http_response_headers_transform'
]

const productOptions = ['zoneLockdown', 'uaBlock', 'hot', 'bic', 'securityLevel', 'rateLimit']

const selectedPhase = ref('http_request_firewall_managed')
const rulesets = ref([])
const selectedRulesetId = ref('')
const rulesetsRequestBody = computed(() => ({ apiKey: apiKey.value, currZone: zoneId.value }))
const rulesetRequestBody = computed(() => ({
	apiKey: apiKey.value,
	currZone: zoneId.value,
	rulesetId: selectedRulesetId.value
}))
const {
	data: rulesetsData,
	error: rulesetsError,
	refresh: refreshRulesetsData
} = useFetch('/api/rulesets', {
	method: 'POST',
	body: rulesetsRequestBody,
	server: false,
	immediate: false
})
const {
	data: rulesetData,
	error: rulesetError,
	refresh: refreshRulesetData
} = useFetch('/api/ruleset', {
	method: 'POST',
	body: rulesetRequestBody,
	server: false,
	immediate: false
})

const rulesetOptions = computed(() => {
	const filtered = (rulesets.value || []).filter((r) => r && r.phase === selectedPhase.value)
	return filtered.map((r) => ({
		label: `${r.name || 'ruleset'} (${r.kind || 'unknown'})`,
		value: r.id
	}))
})

const loadingRulesets = ref(false)
const loadingRules = ref(false)
const rulesRows = ref([])

const rulesColumns = [
	{ id: 'enabled', accessorKey: 'enabled', header: 'Enabled' },
	{ id: 'action', accessorKey: 'action', header: 'Action' },
	{ id: 'description', accessorKey: 'description', header: 'Description' },
	{ id: 'logging', accessorKey: 'logging', header: 'Logging' },
	{ id: 'expression', accessorKey: 'expression', header: 'Expression' },
	{ id: 'id', accessorKey: 'id', header: 'ID' }
]

const refreshRulesets = async () => {
	if (!canRulesets.value) return
	loadingRulesets.value = true
	try {
		await refreshRulesetsData()
		if (rulesetsError.value) throw rulesetsError.value
		const data = rulesetsData.value
		if (!data || !data.success) {
			toast.add({
				id: 'rulesets-error' + Date.now(),
				title: 'Failed to load rulesets',
				description: data?.errors?.[0]?.message || 'Unknown error',
				icon: 'i-clarity-warning-solid',
				duration: 4000,
				color: 'error'
			})
			return
		}

		rulesets.value = data.result || []

		const candidates = (rulesets.value || []).filter((r) => r && r.phase === selectedPhase.value)
		const zoneCandidate = candidates.find((r) => r.kind === 'zone')
		selectedRulesetId.value = (zoneCandidate || candidates[0] || {}).id || ''
	} catch (e) {
		const message = e?.data?.statusMessage || e?.statusMessage || e?.message || 'Unknown error'
		toast.add({
			id: 'rulesets-error' + Date.now(),
			title: 'Failed to load rulesets',
			description: message,
			icon: 'i-clarity-warning-solid',
			duration: 4000,
			color: 'error'
		})
	} finally {
		loadingRulesets.value = false
	}
}

const refreshRules = async () => {
	if (!canRulesets.value) return
	if (!selectedRulesetId.value) {
		rulesRows.value = []
		return
	}

	loadingRules.value = true
	try {
		await refreshRulesetData()
		if (rulesetError.value) throw rulesetError.value
		const data = rulesetData.value
		if (!data || !data.success) {
			toast.add({
				id: 'ruleset-error' + Date.now(),
				title: 'Failed to load rules',
				description: data?.errors?.[0]?.message || 'Unknown error',
				icon: 'i-clarity-warning-solid',
				duration: 4000,
				color: 'error'
			})
			return
		}

		const rules = data.result?.rules || []
		rulesRows.value = rules.map((r) => ({
			id: r.id,
			enabled: r.enabled,
			action: r.action,
			description: r.description || '',
			logging: r.logging?.enabled === true ? 'on' : r.logging?.enabled === false ? 'off' : '',
			expression: r.expression || ''
		}))
	} catch (e) {
		const message = e?.data?.statusMessage || e?.statusMessage || e?.message || 'Unknown error'
		toast.add({
			id: 'ruleset-error' + Date.now(),
			title: 'Failed to load rules',
			description: message,
			icon: 'i-clarity-warning-solid',
			duration: 4000,
			color: 'error'
		})
	} finally {
		loadingRules.value = false
	}
}

watch(selectedPhase, async () => {
	await refreshRulesets()
	await refreshRules()
})

watch(selectedRulesetId, async () => {
	await refreshRules()
})

const bypassToken = ref('')
const description = ref('Allow Rules')
const enabled = ref(true)
const loggingEnabled = ref(true)

const skipCurrentRuleset = ref(true)
const skipPhases = ref([...phaseOptions])
const skipProducts = ref([...productOptions])

const expressionPreview = computed(() => {
	if (!bypassToken.value) return ''
	return `(any(http.request.headers["x-cf-bypass-token"][*] eq "${bypassToken.value}"))`
})

const canSubmit = computed(() => {
	return Boolean(apiKey.value && zoneId.value && selectedRulesetId.value && bypassToken.value)
})

const creating = ref(false)

const createRule = async () => {
	if (!canRulesets.value) return
	if (!canSubmit.value) return
	creating.value = true
	try {
		const actionParameters = {}
		if (skipCurrentRuleset.value) actionParameters.ruleset = 'current'
		if (skipPhases.value && skipPhases.value.length) actionParameters.phases = skipPhases.value
		if (skipProducts.value && skipProducts.value.length) actionParameters.products = skipProducts.value

		const res = await fetch('/api/create_skip_rule', {
			method: 'POST',
			body: JSON.stringify({
				apiKey: apiKey.value,
				currZone: zoneId.value,
				rulesetId: selectedRulesetId.value,
				bypassToken: bypassToken.value,
				description: description.value,
				enabled: enabled.value,
				loggingEnabled: loggingEnabled.value,
				actionParameters
			})
		})

		const data = await res.json()
		if (!data.success) {
			toast.add({
				id: 'create-skip-rule-error' + Date.now(),
				title: 'Failed to create rule',
				description: data.errors?.[0]?.message || 'Unknown error',
				icon: 'i-clarity-warning-solid',
				duration: 5000,
				color: 'error'
			})
			return
		}

		toast.add({
			id: 'create-skip-rule-success' + Date.now(),
			title: 'Rule created',
			description: 'Skip rule added successfully',
			icon: 'i-clarity-check-circle-solid',
			duration: 3000,
			color: 'success'
		})

		await refreshRules()
	} catch (e) {
		toast.add({
			id: 'create-skip-rule-error' + Date.now(),
			title: 'Failed to create rule',
			description: e.message || 'Unknown error',
			icon: 'i-clarity-warning-solid',
			duration: 5000,
			color: 'error'
		})
	} finally {
		creating.value = false
	}
}

const copyExpression = async () => {
	if (!expressionPreview.value) return
	await navigator.clipboard.writeText(expressionPreview.value)
	toast.add({
		id: 'copy-expression' + Date.now(),
		title: 'Copied',
		description: 'Expression copied to clipboard',
		icon: 'i-clarity-check-circle-solid',
		duration: 2500,
		color: 'success'
	})
}

const generateToken = () => {
	const bytes = new Uint8Array(64)
	crypto.getRandomValues(bytes)
	bypassToken.value = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

const copyToken = async () => {
	if (!bypassToken.value) return
	await navigator.clipboard.writeText(bypassToken.value)
	toast.add({
		id: 'copy-token' + Date.now(),
		title: 'Copied',
		description: 'Token copied to clipboard',
		icon: 'i-clarity-check-circle-solid',
		duration: 2500,
		color: 'success'
	})
}

onMounted(async () => {
	apiKey.value = getApiKey()
	if (!apiKey.value) return
	zoneName.value = localStorage.getItem(STORAGE_KEYS.zoneName) || ''
	try {
		const { loadZone, missing } = useCapabilities()
		const caps = await loadZone(apiKey.value, zoneId.value)
		capabilities.value = caps
		capabilityMissing.value = missing(caps)
	} catch {
		capabilities.value = null
		capabilityMissing.value = []
	}

	if (canRulesets.value) {
		await refreshRulesets()
		await refreshRules()
	}
})
</script>
