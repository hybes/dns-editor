<template>
	<UDashboardPanel id="tool-dns-lookup">
		<template #header>
			<UDashboardNavbar title="DNS Lookup">
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<p role="status" class="sr-only">{{ announcement }}</p>

			<form class="flex flex-col gap-3" novalidate @submit.prevent="submitLookup">
				<p class="text-muted text-sm">
					Ask Cloudflare’s and Google’s public resolvers what they return for a name right now, or enter an IP
					address for a reverse lookup.
				</p>

				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_13rem_auto] lg:items-start">
					<UFormField
						label="Name or IP address"
						:error="inputError || undefined"
						class="sm:col-span-2 lg:col-span-1"
					>
						<UInput
							ref="nameInput"
							v-model="name"
							icon="i-lucide-globe"
							placeholder="example.com, _dmarc.example.com or 1.1.1.1"
							autocomplete="off"
							autocapitalize="off"
							:spellcheck="false"
							class="w-full"
							@update:model-value="inputError = ''"
						/>
					</UFormField>
					<UFormField label="Record type" :error="typeError || undefined">
						<USelect
							ref="typeSelect"
							v-model="type"
							:items="typeOptions"
							placeholder="Choose a type"
							class="w-full"
							@update:model-value="typeError = ''"
						/>
					</UFormField>
					<UFormField label="Resolvers">
						<USelect v-model="resolverChoice" :items="resolverOptions" class="w-full" />
					</UFormField>
					<UButton
						type="submit"
						icon="i-lucide-search"
						:loading="loading"
						class="justify-center sm:col-span-2 lg:col-span-1 lg:mt-6"
					>
						Look up
					</UButton>
				</div>

				<div
					v-if="recentLookups.length"
					role="group"
					aria-labelledby="recent-lookups-label"
					class="flex flex-wrap items-center gap-1.5"
				>
					<span id="recent-lookups-label" class="text-muted me-1 text-xs">Recent</span>
					<UButton
						v-for="item in recentLookups"
						:key="`${item.name}|${item.type}`"
						size="xs"
						variant="soft"
						color="neutral"
						:disabled="loading"
						class="font-mono"
						@click="applyRecent(item)"
					>
						{{ item.name }}
						<span class="text-dimmed">{{ recentTypeLabel(item) }}</span>
					</UButton>
					<UButton
						size="xs"
						variant="ghost"
						color="neutral"
						icon="i-lucide-x"
						aria-label="Clear recent lookups"
						@click="clearRecent"
					/>
				</div>
			</form>

			<UAlert
				v-if="error"
				role="alert"
				color="error"
				variant="subtle"
				icon="i-lucide-circle-alert"
				title="Lookup failed"
				:description="error"
				:actions="[
					{
						label: 'Try again',
						color: 'neutral',
						variant: 'outline',
						icon: 'i-lucide-refresh-cw',
						onClick: retry
					}
				]"
			/>

			<p v-if="loading && pending" class="text-muted flex items-center gap-2 text-sm">
				<UIcon
					name="i-lucide-loader-circle"
					class="size-4 shrink-0 animate-spin motion-reduce:animate-none"
					aria-hidden="true"
				/>
				{{ loadingMessage }}
			</p>

			<section
				v-if="result"
				aria-labelledby="lookup-result-heading"
				:aria-busy="loading"
				class="flex flex-col gap-5 transition-opacity"
				:class="{ 'opacity-50': loading }"
			>
				<header class="flex flex-wrap items-start gap-x-4 gap-y-3">
					<div class="min-w-0 flex-1">
						<h2
							id="lookup-result-heading"
							class="text-highlighted font-mono text-base font-semibold break-all"
						>
							{{ resultTitle }}
						</h2>
						<p class="text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
							<span v-if="result.reverse">
								Reverse lookup: PTR records for
								<span class="font-mono break-all">{{ result.name }}</span>
							</span>
							<span v-else>{{
								result.type === 'ALL' ? 'All common record types' : `${result.type} records`
							}}</span>
							<span aria-hidden="true">·</span>
							<span>
								Checked <time :datetime="result.checkedAt">{{ formatTime(result.checkedAt) }}</time>
							</span>
							<UBadge
								v-if="result.agreement.compared"
								:color="result.agreement.matches ? 'success' : 'warning'"
								variant="subtle"
								size="sm"
								:icon="result.agreement.matches ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
							>
								{{ result.agreement.matches ? 'Resolvers agree' : 'Resolvers differ' }}
							</UBadge>
						</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<UButton
							v-if="canWiden"
							size="sm"
							variant="outline"
							color="neutral"
							icon="i-lucide-list"
							:disabled="loading"
							@click="lookUpAllTypes"
						>
							Look up all common types
						</UButton>
						<UButton
							v-if="propagationLink"
							size="sm"
							variant="outline"
							color="neutral"
							icon="i-lucide-radar"
							:to="propagationLink"
						>
							Check propagation
						</UButton>
						<UButton
							size="sm"
							variant="outline"
							color="neutral"
							icon="i-lucide-copy"
							@click="copy(JSON.stringify(result, null, 2), 'Lookup result JSON')"
						>
							Copy JSON
						</UButton>
					</div>
				</header>

				<section
					v-for="resolver in result.resolvers"
					:key="resolver.id"
					:aria-labelledby="`resolver-${resolver.id}`"
					class="border-default border-t pt-3"
				>
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
						<h3 :id="`resolver-${resolver.id}`" class="text-highlighted text-sm font-semibold">
							{{ resolver.label }}
						</h3>
						<span class="text-dimmed font-mono text-xs">{{ resolver.address }}</span>
						<UBadge v-if="resolver.ok" :color="statusColor(resolver.status)" variant="subtle" size="sm">
							{{ resolver.status }}
						</UBadge>
						<UBadge
							v-if="resolver.ok && resolver.dnssec"
							color="success"
							variant="subtle"
							size="sm"
							icon="i-lucide-shield-check"
						>
							DNSSEC validated
						</UBadge>
						<span class="text-dimmed ms-auto text-xs tabular-nums">{{ resolver.durationMs }} ms</span>
					</div>

					<p v-if="!resolver.ok" class="text-error mt-2 text-sm">{{ resolver.error }}</p>

					<template v-else>
						<ul
							v-if="resolver.answers.length"
							class="divide-default mt-1 divide-y"
							:aria-label="`Answers from ${resolver.label}`"
						>
							<li
								v-for="(record, index) in resolver.answers"
								:key="index"
								class="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-4"
							>
								<div class="flex shrink-0 items-center gap-2 sm:w-36 sm:pt-0.5">
									<UBadge
										:color="getRecordTypeColor(record.type)"
										variant="subtle"
										size="sm"
										class="font-mono"
									>
										{{ record.type }}
									</UBadge>
									<span class="text-muted font-mono text-xs tabular-nums"
										>TTL {{ record.ttl ?? '–' }}</span
									>
								</div>
								<div class="flex min-w-0 flex-1 items-start gap-2">
									<div class="min-w-0 flex-1">
										<p
											v-if="showNames(resolver)"
											class="text-muted font-mono text-xs wrap-anywhere"
										>
											{{ record.name }}
										</p>
										<p class="text-highlighted font-mono text-sm wrap-anywhere">
											{{ record.data }}
										</p>
									</div>
									<UButton
										size="xs"
										variant="ghost"
										color="neutral"
										icon="i-lucide-copy"
										:aria-label="`Copy ${record.type} value ${shorten(record.data)}`"
										class="shrink-0"
										@click="copyValue(record)"
									/>
								</div>
							</li>
						</ul>

						<p v-else class="text-muted mt-2 text-sm">{{ emptyReason(resolver) }}</p>

						<div v-if="resolver.authority.length" class="mt-2">
							<h4 class="text-muted text-xs font-medium">Authority section</h4>
							<ul class="mt-1 space-y-0.5">
								<li
									v-for="(record, index) in resolver.authority"
									:key="index"
									class="text-muted font-mono text-xs wrap-anywhere"
								>
									{{ record.name || '.' }} {{ record.type }} {{ record.data }}
								</li>
							</ul>
						</div>

						<p v-if="resolver.comment" class="text-dimmed mt-2 text-xs">{{ resolver.comment }}</p>
					</template>
				</section>
			</section>
		</template>
	</UDashboardPanel>
</template>

<script setup>
import { LOOKUP_RECORD_TYPES, PROPAGATION_TYPES } from '#shared/utils/dnsTypes'

const route = useRoute()
const router = useRouter()
const { call } = useCfApi()
const { copy } = useNotify()
const { getRecordTypeColor } = useRecordTypes()

const MAX_RECENT = 8
const COPY_LABEL_LENGTH = 48

const typeOptions = [
	{ label: 'All common types', value: 'ALL' },
	...LOOKUP_RECORD_TYPES.map((t) => ({ label: t, value: t }))
]
const resolverOptions = [
	{ label: 'Cloudflare and Google', value: 'both' },
	{ label: 'Cloudflare (1.1.1.1)', value: 'cloudflare' },
	{ label: 'Google (8.8.8.8)', value: 'google' }
]
const RESOLVER_NAMES = { cloudflare: 'Cloudflare', google: 'Google' }

const queryString = (value) => (typeof value === 'string' ? value : '')
const isKnownType = (value) => value === 'ALL' || LOOKUP_RECORD_TYPES.includes(value)

const nameInput = useTemplateRef('nameInput')
const typeSelect = useTemplateRef('typeSelect')

const name = ref('')
const type = ref('A')
const resolverChoice = ref('both')
const loading = ref(false)
const pending = ref(null)
const lastParams = ref(null)
const error = ref('')
const inputError = ref('')
const typeError = ref('')
const result = ref(null)
const recentLookups = ref([])
const announcement = ref('')

// Each run gets an id; a response is only applied if no newer run has started since.
let requestId = 0
// The name and type last read from or written to the URL, so the query watcher can tell
// this page's own router.replace apart from navigation to a different lookup.
let routeKey = null

const resultTitle = computed(() => (result.value?.reverse ? result.value.input : result.value?.name) || '')

useSeoMeta({ title: () => (result.value ? `${resultTitle.value} · DNS Lookup` : 'DNS Lookup') })

const resolversFor = (choice) => (choice === 'both' ? ['cloudflare', 'google'] : [choice])

const loadingMessage = computed(() => {
	const params = pending.value
	if (!params) return ''
	const who = params.resolvers.map((id) => RESOLVER_NAMES[id] || id).join(' and ')
	const what = params.type === 'ALL' ? 'all common record types' : `${params.type} records`
	return `Asking ${who} for ${what} for ${params.name}…`
})

const noAnswers = computed(
	() => Boolean(result.value) && result.value.resolvers.every((resolver) => resolver.ok && !resolver.answers.length)
)
const canWiden = computed(() => noAnswers.value && result.value.type !== 'ALL' && !result.value.reverse)

const propagationLink = computed(() => {
	const data = result.value
	if (!data) return null
	const checkType = data.reverse ? 'PTR' : data.type === 'ALL' ? 'A' : data.type
	if (!PROPAGATION_TYPES.includes(checkType)) return null
	return {
		path: '/tools/propagation',
		query: { name: data.input, type: checkType, zone: queryString(route.query.zone) || undefined }
	}
})

const statusColor = (status) => {
	if (status === 'NOERROR') return 'success'
	if (status === 'NXDOMAIN') return 'warning'
	return 'error'
}

const emptyReason = (resolver) => {
	const what = result.value.type === 'ALL' ? 'common' : result.value.type
	if (resolver.status === 'NXDOMAIN') return `${resolver.label} reports that this name does not exist.`
	if (resolver.status === 'NOERROR') return `The name exists but has no ${what} records.`
	return `${resolver.label} answered ${resolver.status}.`
}

// Names are only worth a line when some answer belongs to another name, such as a CNAME target.
const showNames = (resolver) => resolver.answers.some((record) => record.name !== result.value.name)

const shorten = (value) => (value.length > COPY_LABEL_LENGTH ? `${value.slice(0, COPY_LABEL_LENGTH - 1)}…` : value)

const copyValue = (record) =>
	copy(record.data, record.data.length > COPY_LABEL_LENGTH ? `${record.type} value` : record.data)

const recentTypeLabel = (item) => {
	if (isIp(item.name)) return 'PTR'
	return item.type === 'ALL' ? 'all' : item.type
}

const readRecent = () => {
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.dnsLookupRecent) || '[]')
		return (Array.isArray(parsed) ? parsed : [])
			.filter((item) => typeof item?.name === 'string' && item.name && isKnownType(item.type))
			.slice(0, MAX_RECENT)
	} catch {
		return []
	}
}

const saveRecent = () => {
	try {
		if (recentLookups.value.length) {
			localStorage.setItem(STORAGE_KEYS.dnsLookupRecent, JSON.stringify(recentLookups.value))
		} else {
			localStorage.removeItem(STORAGE_KEYS.dnsLookupRecent)
		}
	} catch {
		// Recent lookups are a convenience; a blocked storage write only loses the list.
	}
}

const rememberLookup = (entry) => {
	const rest = recentLookups.value.filter((item) => item.name !== entry.name || item.type !== entry.type)
	recentLookups.value = [entry, ...rest].slice(0, MAX_RECENT)
	saveRecent()
}

const clearRecent = () => {
	recentLookups.value = []
	saveRecent()
}

const describeOutcome = (data) => {
	const parts = data.resolvers.map((resolver) => {
		if (!resolver.ok) return `${resolver.label} failed`
		const count = resolver.answers.length
		return `${resolver.label} returned ${count} ${count === 1 ? 'record' : 'records'}`
	})
	return `Lookup finished for ${data.reverse ? data.input : data.name}: ${parts.join(', ')}.`
}

const writeQuery = (lookupName, lookupType) => {
	routeKey = `${lookupName}|${lookupType}`
	router.replace({ query: { ...route.query, name: lookupName, type: lookupType } })
}

const runLookup = async (params) => {
	const id = ++requestId
	loading.value = true
	pending.value = params
	lastParams.value = params
	error.value = ''
	inputError.value = ''
	announcement.value = ''
	try {
		const data = await call(
			'dns_lookup',
			{ name: params.name, type: params.type, resolvers: params.resolvers },
			{ auth: false, fallback: 'The lookup failed' }
		)
		if (id !== requestId) return
		result.value = data.result
		rememberLookup({ name: data.result.input, type: params.type })
		announcement.value = describeOutcome(data.result)
	} catch (e) {
		if (id !== requestId) return
		const message = describeError(e, 'The lookup failed')
		result.value = null
		// The alert announces other failures itself; a field error has no live region.
		if (isInputError(e)) {
			inputError.value = message
			announcement.value = `Lookup failed: ${message}`
		} else {
			error.value = message
		}
	} finally {
		if (id === requestId) {
			loading.value = false
			pending.value = null
		}
	}
}

const submitLookup = () => {
	const trimmed = name.value.trim()
	inputError.value = ''
	typeError.value = ''
	// Focusing the field reads its error, which is linked to it, to screen reader users.
	if (!trimmed) {
		inputError.value = 'Enter a domain name or IP address.'
		nextTick(() => nameInput.value?.inputRef?.focus())
		return
	}
	if (!type.value) {
		typeError.value = 'Choose a record type.'
		nextTick(() => typeSelect.value?.triggerRef?.focus())
		return
	}
	writeQuery(trimmed, type.value)
	runLookup({ name: trimmed, type: type.value, resolvers: resolversFor(resolverChoice.value) })
}

const retry = () => {
	if (lastParams.value) runLookup(lastParams.value)
}

const applyRecent = (item) => {
	if (loading.value) return
	name.value = item.name
	type.value = item.type
	submitLookup()
}

const lookUpAllTypes = () => {
	type.value = 'ALL'
	submitLookup()
}

// Links such as /tools/dns-lookup?name=example.com&type=ALL reuse this page when it is
// already open, so the URL is watched rather than read once.
watch(
	() => [route.query.name, route.query.type],
	([queryName, queryType]) => {
		const incomingName = queryString(queryName).trim()
		const incomingType = queryString(queryType).trim().toUpperCase()
		const key = `${incomingName}|${incomingType}`
		if (key === routeKey) return
		routeKey = key

		requestId++
		loading.value = false
		pending.value = null
		error.value = ''
		inputError.value = ''
		typeError.value = ''
		name.value = incomingName

		if (!incomingName) {
			type.value = 'A'
			result.value = null
			announcement.value = ''
			return
		}
		if (incomingType && !isKnownType(incomingType)) {
			type.value = ''
			result.value = null
			typeError.value = `${incomingType} lookups aren’t supported. Choose one of the listed types.`
			return
		}
		type.value = incomingType || 'A'
		runLookup({ name: incomingName, type: type.value, resolvers: resolversFor(resolverChoice.value) })
	},
	{ immediate: true }
)

onMounted(() => {
	recentLookups.value = readRecent()
})
</script>
