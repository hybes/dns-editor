<template>
	<UDashboardPanel id="tool-propagation">
		<template #header>
			<UDashboardNavbar title="Propagation Check">
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<p role="status" class="sr-only">{{ announcement }}</p>

			<form class="flex flex-col gap-3" novalidate @submit.prevent="submitCheck">
				<p class="text-muted text-sm">
					Compare what the zone’s own nameservers and {{ resolverCount }} public resolvers return for a
					record, to see which resolvers have picked up a change.
				</p>

				<div
					class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_9rem_minmax(0,1fr)_auto] lg:items-start"
				>
					<UFormField label="Name" :error="inputError || undefined" class="sm:col-span-2 lg:col-span-1">
						<UInput
							ref="nameInput"
							v-model="name"
							icon="i-lucide-globe"
							placeholder="www.example.com"
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
							@update:model-value="onTypeChosen"
						/>
					</UFormField>
					<UFormField
						label="Expected value"
						hint="Optional"
						help="Leave blank to compare resolvers with the zone’s nameservers."
						:error="expectedError || undefined"
					>
						<UInput
							v-model="expected"
							placeholder="203.0.113.10"
							autocomplete="off"
							autocapitalize="off"
							:spellcheck="false"
							class="w-full"
							:ui="{ base: 'font-mono' }"
							@update:model-value="expectedError = ''"
						/>
					</UFormField>
					<UButton
						type="submit"
						icon="i-lucide-radar"
						:loading="loading && !silentLoading"
						class="justify-center sm:col-span-2 lg:col-span-1 lg:mt-6"
					>
						Check
					</UButton>
				</div>
			</form>

			<UAlert
				v-if="unsupportedType"
				color="warning"
				variant="subtle"
				icon="i-lucide-triangle-alert"
				:title="`${unsupportedType} records can’t be checked for propagation`"
				:description="`This check compares ${PROPAGATION_TYPES.join(', ')} records. DNS Lookup can show what Cloudflare and Google return for ${unsupportedType} records.`"
				:actions="[
					{
						label: 'Open in DNS Lookup',
						icon: 'i-lucide-text-search',
						color: 'neutral',
						variant: 'outline',
						to: unsupportedLookupLink
					}
				]"
			/>

			<UAlert
				v-if="showProxiedNotice"
				color="info"
				variant="subtle"
				icon="i-lucide-cloud"
				title="This record is proxied"
				description="Resolvers return Cloudflare’s edge addresses rather than the origin value, so they are compared with the zone’s nameservers instead."
			/>

			<UAlert
				v-if="error"
				role="alert"
				color="error"
				variant="subtle"
				icon="i-lucide-circle-alert"
				:title="errorTitle"
				:description="error"
				:actions="[
					{
						label: 'Try again',
						icon: 'i-lucide-refresh-cw',
						color: 'neutral',
						variant: 'outline',
						onClick: retry
					}
				]"
			/>

			<p v-if="loading && !silentLoading && pending" class="text-muted flex items-center gap-2 text-sm">
				<UIcon
					name="i-lucide-loader-circle"
					class="size-4 shrink-0 animate-spin motion-reduce:animate-none"
					aria-hidden="true"
				/>
				<span>
					Asking the zone’s nameservers and {{ resolverCount }} public resolvers about
					<span class="font-mono break-all">{{ pending.name }}</span
					>. This can take up to 20 seconds.
				</span>
			</p>

			<div
				v-if="result && verdict"
				class="flex flex-col gap-6 transition-opacity"
				:class="{ 'opacity-50': loading && !silentLoading }"
				:aria-busy="loading"
			>
				<section aria-labelledby="propagation-verdict">
					<div class="flex flex-wrap items-start gap-x-4 gap-y-3">
						<div class="min-w-0 flex-1">
							<h2
								id="propagation-verdict"
								class="text-highlighted flex items-start gap-2 text-lg font-semibold"
							>
								<UIcon
									:name="verdict.icon"
									class="mt-1 size-5 shrink-0"
									:class="TONE_TEXT[verdict.tone]"
									aria-hidden="true"
								/>
								<span>{{ verdict.title }}</span>
							</h2>
							<p class="text-muted mt-1 text-sm">{{ verdict.detail }}</p>
							<p class="mt-2 flex flex-wrap items-center gap-2 text-sm">
								<span class="text-highlighted font-mono break-all">{{ result.name }}</span>
								<UBadge color="neutral" variant="subtle" size="sm">{{ result.type }}</UBadge>
								<UBadge
									v-if="result.reference?.source === 'expected'"
									color="info"
									variant="subtle"
									size="sm"
									class="max-w-full"
								>
									<span class="truncate">Looking for {{ result.reference.expected }}</span>
								</UBadge>
							</p>
							<p v-if="result.wildcard" class="text-muted mt-1 text-xs">
								Checked through <span class="font-mono break-all">{{ result.queriedName }}</span
								>, a name the wildcard covers.
							</p>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<UButton
								size="sm"
								variant="outline"
								color="neutral"
								icon="i-lucide-text-search"
								:to="lookupLink"
							>
								Open in DNS Lookup
							</UButton>
							<UButton
								size="sm"
								variant="outline"
								color="neutral"
								icon="i-lucide-copy"
								@click="copy(JSON.stringify(result, null, 2), 'Propagation result JSON')"
							>
								Copy JSON
							</UButton>
						</div>
					</div>

					<UProgress
						v-if="result.summary.total"
						:model-value="result.summary.matched"
						:max="result.summary.total"
						:color="verdict.tone"
						size="sm"
						class="mt-4"
						aria-hidden="true"
					/>
					<p class="text-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
						<span>{{ result.summary.matched }} up to date</span>
						<span>{{ result.summary.stale }} stale</span>
						<span v-if="result.summary.unknown">{{ result.summary.unknown }} not compared</span>
						<span v-if="result.summary.maxStaleTtl !== null">
							Stale caches expire within {{ formatDuration(result.summary.maxStaleTtl) }}
						</span>
						<span class="sm:ms-auto">
							Checked at <time :datetime="result.checkedAt">{{ formatTime(result.checkedAt) }}</time>
						</span>
					</p>

					<div class="border-default mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
						<USwitch v-model="autoRecheck" :label="recheckLabel" />
						<p v-if="autoRecheck && (silentLoading || nextCheckAt)" class="text-muted text-xs">
							<template v-if="silentLoading">Checking now…</template>
							<template v-else>
								Next check at <time :datetime="nextCheckAt">{{ formatTime(nextCheckAt) }}</time>
							</template>
						</p>
						<UButton
							size="sm"
							variant="outline"
							color="neutral"
							icon="i-lucide-refresh-cw"
							:loading="loading && !silentLoading"
							class="sm:ms-auto"
							@click="checkAgain"
						>
							Check again
						</UButton>
					</div>
				</section>

				<section v-for="section in sections" :key="section.id" :aria-labelledby="`${section.id}-heading`">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
						<h2 :id="`${section.id}-heading`" class="text-highlighted text-sm font-semibold">
							{{ section.title }}
						</h2>
						<span
							v-if="section.note"
							class="text-dimmed text-xs"
							:class="{ 'font-mono': section.noteMono }"
						>
							{{ section.note }}
						</span>
						<UBadge
							v-if="section.badge"
							:color="section.badge.color"
							:icon="section.badge.icon"
							variant="subtle"
							size="sm"
							class="ms-auto"
						>
							{{ section.badge.label }}
						</UBadge>
					</div>

					<p v-if="section.error" class="text-error mt-2 text-sm">{{ section.error }}</p>
					<ul v-else class="divide-default border-default mt-2 divide-y border-y">
						<li
							v-for="row in section.rows"
							:key="row.key"
							class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 py-2.5 md:grid-cols-[minmax(0,13rem)_8rem_minmax(0,1fr)_5.5rem]"
						>
							<div class="min-w-0">
								<p
									class="text-highlighted text-xs font-medium wrap-anywhere"
									:class="{ 'font-mono': row.mono }"
								>
									{{ row.title }}
								</p>
								<p class="text-dimmed text-xs wrap-anywhere">{{ row.subtitle }}</p>
							</div>
							<div class="justify-self-end md:justify-self-start">
								<UBadge :color="row.outcome.color" variant="subtle" size="sm">{{
									row.outcome.label
								}}</UBadge>
							</div>
							<div class="col-span-2 min-w-0 md:col-span-1">
								<ul
									v-if="row.values.length"
									class="space-y-0.5"
									:aria-label="`Answer from ${row.title}`"
								>
									<li
										v-for="(value, index) in row.values"
										:key="index"
										class="flex items-start gap-1"
									>
										<span class="text-highlighted min-w-0 flex-1 font-mono text-xs wrap-anywhere">
											{{ value }}
										</span>
										<UButton
											size="xs"
											variant="ghost"
											color="neutral"
											icon="i-lucide-copy"
											class="-my-1 shrink-0"
											:aria-label="`Copy ${shorten(value)} from ${row.title}`"
											@click="copyValue(value)"
										/>
									</li>
								</ul>
								<p v-else class="text-muted text-xs">{{ row.failure }}</p>
							</div>
							<p
								class="text-dimmed col-span-2 flex flex-wrap gap-x-3 text-xs tabular-nums md:col-span-1 md:flex-col md:items-end"
							>
								<span v-for="item in row.meta" :key="item">{{ item }}</span>
							</p>
						</li>
					</ul>
					<p v-if="section.footnote" class="text-dimmed mt-2 text-xs">{{ section.footnote }}</p>
				</section>
			</div>
		</template>
	</UDashboardPanel>
</template>

<script setup>
import { useDocumentVisibility } from '@vueuse/core'
import { PROPAGATION_TYPES } from '#shared/utils/dnsTypes'

const route = useRoute()
const router = useRouter()
const { call } = useCfApi()
const { copy, success } = useNotify()

// Mirrors PUBLIC_RESOLVERS in server/utils/dnsResolve.js. The page needs the count before
// its first check; after that the result's own figures are used.
const DEFAULT_RESOLVER_COUNT = 15
const DEFAULT_QUERY_TIMEOUT_MS = 4000
const RECHECK_INTERVAL_MS = 30000
const COPY_LABEL_LENGTH = 48

const typeOptions = PROPAGATION_TYPES.map((t) => ({ label: t, value: t }))
const recheckLabel = `Re-check every ${RECHECK_INTERVAL_MS / 1000} seconds`
const TONE_TEXT = { success: 'text-success', warning: 'text-warning', neutral: 'text-muted' }

const queryString = (value) => (typeof value === 'string' ? value : '')
const normaliseName = (value) =>
	String(value || '')
		.trim()
		.toLowerCase()
		.replace(/\.$/, '')

const name = ref('')
const type = ref('A')
const expected = ref('')
// The name a proxied=1 link arrived with; the notice only applies while that name is checked.
const proxiedFor = ref('')
const unsupportedType = ref('')
const loading = ref(false)
const silentLoading = ref(false)
const pending = ref(null)
const lastAttempt = ref(null)
const error = ref('')
const errorTitle = ref('Check failed')
const inputError = ref('')
const typeError = ref('')
const expectedError = ref('')
const nameInput = useTemplateRef('nameInput')
const typeSelect = useTemplateRef('typeSelect')
const result = ref(null)
// Parameters of the check on screen. Auto re-check repeats these, never the live form.
const snapshot = ref(null)
const autoRecheck = ref(false)
const nextCheckAt = ref('')
const announcement = ref('')
const visibility = useDocumentVisibility()

let requestId = 0
let routeKey = null
let recheckTimer = null
let lastCheckedAt = 0

useSeoMeta({
	title: () => (result.value ? `${result.value.name} ${result.value.type} · Propagation Check` : 'Propagation Check')
})

const resolverCount = computed(() => result.value?.resolvers.length || DEFAULT_RESOLVER_COUNT)
const showProxiedNotice = computed(
	() => Boolean(proxiedFor.value) && proxiedFor.value === normaliseName(name.value) && !expected.value.trim()
)

const zoneQuery = () => queryString(route.query.zone) || undefined

const lookupLink = computed(() => {
	const data = result.value
	return {
		path: '/tools/dns-lookup',
		query: {
			name: data ? (data.wildcard ? data.queriedName : data.input) : undefined,
			type: data?.type,
			zone: zoneQuery()
		}
	}
})

const unsupportedLookupLink = computed(() => ({
	path: '/tools/dns-lookup',
	query: { name: name.value.trim() || undefined, type: unsupportedType.value, zone: zoneQuery() }
}))

const verdict = computed(() => {
	const data = result.value
	const summary = data?.summary
	if (!summary) return null
	const reference = data.reference
	// Nameservers with nothing to say while resolvers still answer means a removal is propagating.
	const removal = reference?.source === 'authoritative' && !reference.values.length
	const compared =
		reference?.source === 'expected' ? 'return the expected value' : 'agree with the zone’s nameservers'
	const counts = `${summary.matched} of ${summary.total} resolvers ${compared}.`
	const stillCached = `The zone’s nameservers return no ${data.type} records, but ${summary.stale} of ${summary.total} resolvers still have an old answer cached.`
	switch (summary.state) {
		case 'propagated':
			return {
				tone: 'success',
				icon: 'i-lucide-circle-check',
				title: 'Propagated to every resolver that answered',
				detail: counts
			}
		case 'absent':
			return {
				tone: 'neutral',
				icon: 'i-lucide-circle-slash',
				title: `No ${data.type} records exist anywhere we asked`,
				detail: `The zone’s nameservers and every resolver that answered return nothing for ${data.name}.`
			}
		case 'partial':
			return {
				tone: 'warning',
				icon: 'i-lucide-hourglass',
				title: removal ? 'Removal still propagating' : 'Still propagating',
				detail: removal ? stillCached : counts
			}
		case 'none':
			return {
				tone: 'warning',
				icon: 'i-lucide-clock',
				title: removal ? 'Removal not visible on public resolvers yet' : 'Not visible on public resolvers yet',
				detail: removal ? stillCached : counts
			}
		default: {
			const alias = data.zone.nameservers.find((server) => server.cname)?.cname
			if (!reference && alias) {
				return {
					tone: 'neutral',
					icon: 'i-lucide-corner-down-right',
					title: `${data.name} is a CNAME`,
					detail: `The zone’s nameservers point it at ${alias} instead of returning ${data.type} records, so there is nothing of theirs to compare resolvers with. Choose CNAME to check the alias, or enter the ${data.type} value you expect.`
				}
			}
			return {
				tone: 'neutral',
				icon: 'i-lucide-circle-help',
				title: 'Couldn’t judge propagation',
				detail: reference
					? 'None of the public resolvers gave an answer that could be compared.'
					: 'The zone’s nameservers couldn’t be reached and no expected value was given, so there is nothing to compare against.'
			}
		}
	}
})

const outcome = (server) => {
	if (server.match === true) return { label: 'Up to date', color: 'success' }
	if (server.match === false) {
		return server.ok ? { label: 'Stale', color: 'warning' } : { label: 'Not yet visible', color: 'warning' }
	}
	if (server.cname) return { label: 'CNAME', color: 'neutral' }
	if (server.ok) return { label: 'Answered', color: 'neutral' }
	if (server.status === 'nxdomain') return { label: 'Name not found', color: 'neutral' }
	if (server.status === 'nodata') return { label: 'No records', color: 'neutral' }
	if (server.status === 'timeout') return { label: 'Timed out', color: 'neutral' }
	if (server.status === 'blocked') return { label: 'Not queried', color: 'neutral' }
	if (server.status === 'refused') return { label: 'Refused', color: 'error' }
	if (server.status === 'servfail') return { label: 'Server failure', color: 'error' }
	return { label: 'Error', color: 'error' }
}

const statusText = (server) => {
	if (server.cname) return `CNAME to ${server.cname}`
	if (server.status === 'nxdomain') return 'The name doesn’t exist (NXDOMAIN)'
	if (server.status === 'nodata') return `No ${result.value.type} records`
	if (server.status === 'timeout') {
		const seconds = (result.value.limits?.queryTimeoutMs || DEFAULT_QUERY_TIMEOUT_MS) / 1000
		return `No reply within ${seconds} s`
	}
	return server.error || server.status
}

const serverRow = (server, { key, title, subtitle, mono, extra }) => ({
	key,
	title,
	subtitle,
	mono,
	outcome: outcome(server),
	values: server.ok ? server.values : [],
	failure: server.ok && server.values.length ? '' : statusText(server),
	meta: [extra, `${server.durationMs} ms`].filter(Boolean)
})

const sections = computed(() => {
	const data = result.value
	if (!data) return []
	const { zone } = data
	let zoneBadge = null
	if (zone.agree === true) zoneBadge = { label: 'Nameservers agree', color: 'success', icon: 'i-lucide-check' }
	if (zone.agree === false) {
		zoneBadge = { label: 'Nameservers disagree', color: 'warning', icon: 'i-lucide-triangle-alert' }
	}
	return [
		{
			id: 'nameservers',
			title: 'Zone nameservers',
			note: zone.apex,
			noteMono: true,
			badge: zoneBadge,
			error: zone.error,
			rows: zone.nameservers.map((ns) =>
				serverRow(ns, {
					key: ns.host,
					title: ns.host,
					subtitle: ns.ip || 'No address found',
					mono: true,
					extra: ns.serial !== null && ns.serial !== undefined ? `Serial ${ns.serial}` : ''
				})
			)
		},
		{
			id: 'resolvers',
			title: 'Public resolvers',
			note: `${data.resolvers.length} asked`,
			noteMono: false,
			badge: null,
			error: '',
			rows: data.resolvers.map((resolver) =>
				serverRow(resolver, {
					key: resolver.id,
					title: resolver.label,
					subtitle: `${resolver.region} · ${resolver.ip}`,
					mono: false,
					extra: resolver.ttl !== null && resolver.ttl !== undefined ? `TTL ${resolver.ttl}` : ''
				})
			),
			footnote:
				data.type === 'A' || data.type === 'AAAA'
					? 'TTL is how long each resolver will keep serving its current answer.'
					: `Resolvers only report TTL for A and AAAA records, so none is shown for ${data.type}.`
		}
	]
})

const formatDuration = (seconds) => {
	if (seconds < 60) return `${seconds} s`
	if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`
	return `${Math.round((seconds / 3600) * 10) / 10} h`
}

const shorten = (value) => (value.length > COPY_LABEL_LENGTH ? `${value.slice(0, COPY_LABEL_LENGTH - 1)}…` : value)

const copyValue = (value) => copy(value, value.length > COPY_LABEL_LENGTH ? 'Value' : value)

const describeOutcome = (data) =>
	`Check finished for ${data.name}: ${verdict.value?.title || 'done'}. ${data.summary.matched} of ${data.summary.total} resolvers up to date.`

// URL handling. routeKey holds the last query this page read or wrote, so the watcher below
// can ignore this page's own router.replace and react only to real navigation.
const routeKeyFor = (query) =>
	[
		queryString(query.name).trim(),
		queryString(query.type).trim().toUpperCase(),
		queryString(query.expected),
		query.proxied === '1' ? '1' : ''
	].join('|')

const replaceQuery = (query) => {
	routeKey = routeKeyFor(query)
	router.replace({ query })
}

const writeQuery = (params) => {
	const query = { ...route.query, name: params.name, type: params.type }
	if (params.expected) query.expected = params.expected
	else delete query.expected
	if (params.proxied) query.proxied = '1'
	else delete query.proxied
	replaceQuery(query)
}

// Auto re-check
const clearRecheckTimer = () => {
	if (recheckTimer) clearTimeout(recheckTimer)
	recheckTimer = null
	nextCheckAt.value = ''
}

const scheduleRecheck = () => {
	clearRecheckTimer()
	if (!autoRecheck.value || !snapshot.value || loading.value) return
	// Hidden tabs don't poll; becoming visible again reschedules, running at once if overdue.
	if (visibility.value === 'hidden') return
	const delay = Math.max(0, lastCheckedAt + RECHECK_INTERVAL_MS - Date.now())
	nextCheckAt.value = new Date(Date.now() + delay).toISOString()
	recheckTimer = setTimeout(() => {
		recheckTimer = null
		nextCheckAt.value = ''
		runCheck(snapshot.value, { silent: true })
	}, delay)
}

const cancelPending = () => {
	requestId++
	loading.value = false
	silentLoading.value = false
	pending.value = null
}

const clearResult = () => {
	result.value = null
	snapshot.value = null
	autoRecheck.value = false
	clearRecheckTimer()
}

const runCheck = async (params, { silent = false } = {}) => {
	const id = ++requestId
	clearRecheckTimer()
	loading.value = true
	silentLoading.value = silent
	pending.value = params
	lastAttempt.value = params
	if (!silent) {
		error.value = ''
		announcement.value = ''
	}
	try {
		const data = await call(
			'dns_propagation',
			{ name: params.name, type: params.type, expected: params.expected },
			{ auth: false, fallback: 'The propagation check failed' }
		)
		if (id !== requestId) return
		const previousState = result.value?.summary.state
		result.value = data.result
		snapshot.value = { ...params }
		lastCheckedAt = Date.now()
		error.value = ''
		const { state } = data.result.summary
		// Background checks only speak up when something changed.
		if (!silent || state !== previousState) announcement.value = describeOutcome(data.result)
		if (autoRecheck.value && (state === 'propagated' || state === 'absent')) {
			autoRecheck.value = false
			success(
				state === 'propagated'
					? `${data.result.name} has propagated`
					: `No ${data.result.type} records remain for ${data.result.name}`,
				'Every resolver that answered agrees, so auto re-check has stopped.'
			)
		}
	} catch (e) {
		if (id !== requestId) return
		const message = describeError(e, 'The propagation check failed')
		autoRecheck.value = false
		if (silent) {
			errorTitle.value = 'Re-check failed, so auto re-check has stopped'
			error.value = message
		} else {
			clearResult()
			// The alert announces other failures itself; a field error has no live region.
			if (isInputError(e)) {
				if (e.data?.data?.field === 'expected') expectedError.value = message
				else inputError.value = message
				announcement.value = `Check failed: ${message}`
			} else {
				errorTitle.value = 'Check failed'
				error.value = message
			}
		}
	} finally {
		if (id === requestId) {
			loading.value = false
			silentLoading.value = false
			pending.value = null
			scheduleRecheck()
		}
	}
}

const submitCheck = () => {
	const trimmed = name.value.trim()
	inputError.value = ''
	typeError.value = ''
	expectedError.value = ''
	// Focusing the field reads its error, which is linked to it, to screen reader users.
	if (!trimmed) {
		inputError.value = 'Enter the name to check.'
		nextTick(() => nameInput.value?.inputRef?.focus())
		return
	}
	if (!type.value) {
		typeError.value = 'Choose a record type.'
		nextTick(() => typeSelect.value?.triggerRef?.focus())
		return
	}
	unsupportedType.value = ''
	const params = {
		name: trimmed,
		type: type.value,
		expected: expected.value.trim(),
		proxied: Boolean(proxiedFor.value) && proxiedFor.value === normaliseName(trimmed)
	}
	writeQuery(params)
	runCheck(params)
}

const checkAgain = () => {
	if (snapshot.value) runCheck(snapshot.value)
}

const retry = () => {
	if (lastAttempt.value) runCheck(lastAttempt.value)
}

const onTypeChosen = () => {
	typeError.value = ''
	unsupportedType.value = ''
}

watch(autoRecheck, (enabled) => {
	if (enabled) scheduleRecheck()
	else clearRecheckTimer()
})

watch(visibility, () => {
	if (autoRecheck.value && !loading.value) scheduleRecheck()
})

// Editing the form means the result on screen is no longer what the user is after.
watch([name, type, expected], () => {
	const snap = snapshot.value
	if (!autoRecheck.value || !snap) return
	if (name.value.trim() === snap.name && type.value === snap.type && expected.value.trim() === snap.expected) return
	autoRecheck.value = false
	announcement.value = 'Auto re-check stopped because the form changed.'
})

// A proxied=1 link describes one record; checking any other name drops the flag.
watch(name, (value) => {
	if (!proxiedFor.value || normaliseName(value) === proxiedFor.value) return
	proxiedFor.value = ''
	if (route.query.proxied) {
		const query = { ...route.query }
		delete query.proxied
		replaceQuery(query)
	}
})

// Links from the records page reuse this page when it is already open, so the URL is
// watched rather than read once.
watch(
	() => route.query,
	(query) => {
		const key = routeKeyFor(query)
		if (key === routeKey) return
		routeKey = key

		cancelPending()
		autoRecheck.value = false
		clearRecheckTimer()
		error.value = ''
		inputError.value = ''
		typeError.value = ''
		expectedError.value = ''
		unsupportedType.value = ''

		const incomingName = queryString(query.name).trim()
		const incomingType = queryString(query.type).trim().toUpperCase()
		name.value = incomingName
		expected.value = queryString(query.expected)
		proxiedFor.value = query.proxied === '1' && incomingName ? normaliseName(incomingName) : ''

		if (!incomingName) {
			type.value = 'A'
			clearResult()
			announcement.value = ''
			return
		}
		if (incomingType && !PROPAGATION_TYPES.includes(incomingType)) {
			type.value = ''
			unsupportedType.value = incomingType
			clearResult()
			announcement.value = `${incomingType} records can’t be checked for propagation.`
			return
		}
		type.value = incomingType || 'A'
		runCheck({
			name: incomingName,
			type: type.value,
			expected: expected.value.trim(),
			proxied: Boolean(proxiedFor.value)
		})
	},
	{ immediate: true }
)

onBeforeUnmount(() => {
	requestId++
	clearRecheckTimer()
})
</script>
