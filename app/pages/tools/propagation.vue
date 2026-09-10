<template>
	<PageContainer>
		<Head>
			<Title>Propagation Check</Title>
		</Head>

		<section aria-labelledby="propagation-title" class="mx-auto flex w-full max-w-6xl flex-col gap-6">
			<UButton :to="backTo" variant="ghost" color="neutral" icon="i-clarity-undo-line" class="self-start">
				{{ backLabel }}
			</UButton>

			<header>
				<p class="text-primary text-xs font-semibold tracking-wide uppercase">Tools</p>
				<h1
					id="propagation-title"
					class="text-highlighted mt-1 text-2xl font-semibold tracking-tight sm:text-3xl"
				>
					Propagation Check
				</h1>
				<p class="text-muted mt-2 max-w-2xl text-sm">
					Ask the zone’s own nameservers and {{ resolverCountLabel }} public resolvers for a record, and see
					which of them have picked up your latest change.
				</p>
			</header>

			<form class="surface-panel flex flex-col gap-4 p-4 sm:p-6" @submit.prevent="runCheck()">
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_9rem_minmax(0,1fr)]">
					<UFormField
						label="Name"
						name="propagation-name"
						:error="inputError || undefined"
						class="sm:col-span-2 lg:col-span-1"
					>
						<UInput
							id="propagation-name"
							v-model="name"
							size="lg"
							icon="i-heroicons-globe-alt"
							placeholder="www.example.com"
							autocomplete="off"
							autocapitalize="off"
							:spellcheck="false"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Record type" name="propagation-type">
						<USelect
							v-model="type"
							:items="typeOptions"
							size="lg"
							class="w-full"
							aria-label="Record type"
						/>
					</UFormField>
					<UFormField
						label="Expected value"
						name="propagation-expected"
						help="Optional. Leave blank to compare every resolver against the zone’s nameservers."
					>
						<UInput
							id="propagation-expected"
							v-model="expected"
							size="lg"
							icon="i-heroicons-check-badge"
							placeholder="e.g. 203.0.113.10"
							autocomplete="off"
							autocapitalize="off"
							:spellcheck="false"
							class="w-full font-mono"
						/>
					</UFormField>
				</div>

				<UAlert
					v-if="proxied"
					color="info"
					variant="subtle"
					icon="i-heroicons-cloud"
					title="Proxied record"
					description="This record is proxied through Cloudflare, so resolvers return Cloudflare’s edge addresses rather than the origin value. The check compares against the nameservers instead."
				/>

				<div class="flex flex-wrap items-center justify-between gap-3">
					<p class="text-muted text-xs">
						Each resolver is asked directly. A stale one keeps its old answer until its cached TTL runs out;
						nothing can force it sooner.
					</p>
					<UButton
						type="submit"
						color="primary"
						size="lg"
						icon="i-heroicons-signal"
						:loading="loading"
						:disabled="!name.trim()"
					>
						Check
					</UButton>
				</div>
			</form>

			<UAlert
				v-if="error"
				color="error"
				variant="subtle"
				icon="i-heroicons-exclamation-triangle"
				title="Check Failed"
				:description="error"
			/>

			<template v-if="result">
				<section class="surface-panel p-4 sm:p-6" aria-labelledby="propagation-summary" aria-live="polite">
					<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<UIcon
									:name="verdict.icon"
									:class="verdict.iconClass"
									class="h-6 w-6"
									aria-hidden="true"
								/>
								<h2 id="propagation-summary" class="text-highlighted text-xl font-semibold">
									{{ verdict.title }}
								</h2>
							</div>
							<p class="text-muted mt-1 text-sm">{{ verdict.detail }}</p>
							<p class="mt-2 flex flex-wrap items-center gap-2 text-sm">
								<span class="text-highlighted font-mono break-all">{{ result.name }}</span>
								<UBadge color="neutral" variant="subtle">{{ result.type }}</UBadge>
								<UBadge v-if="result.reference?.source === 'expected'" color="info" variant="subtle">
									Looking for {{ result.reference.expected }}
								</UBadge>
							</p>
						</div>
						<div class="flex flex-wrap items-center gap-3">
							<USwitch v-model="autoRecheck" label="Re-check every 30 s" :disabled="loading" />
							<UButton
								variant="outline"
								color="neutral"
								icon="i-heroicons-arrow-path"
								:loading="loading"
								@click="runCheck()"
							>
								Check Again
							</UButton>
						</div>
					</div>

					<div class="mt-4">
						<div class="bg-muted h-2 w-full overflow-hidden rounded-full" role="presentation">
							<div
								class="h-full rounded-full transition-[width]"
								:class="verdict.barClass"
								:style="{ width: `${progressPercent}%` }"
							/>
						</div>
						<div class="text-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
							<span>{{ result.summary.matched }} up to date</span>
							<span>{{ result.summary.stale }} stale</span>
							<span v-if="result.summary.unknown">{{ result.summary.unknown }} unreachable</span>
							<span v-if="result.summary.maxStaleTtl !== null">
								Stale caches expire within {{ formatDuration(result.summary.maxStaleTtl) }}
							</span>
							<span class="sm:ml-auto">Checked at {{ checkedAtLabel }}</span>
						</div>
					</div>
				</section>

				<section class="surface-panel overflow-hidden" aria-labelledby="nameservers-heading">
					<header class="border-default flex flex-wrap items-center gap-2 border-b px-4 py-3">
						<h2 id="nameservers-heading" class="text-highlighted font-semibold">Zone nameservers</h2>
						<span v-if="result.zone.apex" class="text-dimmed font-mono text-xs">{{
							result.zone.apex
						}}</span>
						<UBadge
							v-if="result.zone.agree === true"
							color="success"
							variant="subtle"
							icon="i-heroicons-check-circle-20-solid"
							class="ml-auto"
						>
							Nameservers agree
						</UBadge>
						<UBadge
							v-else-if="result.zone.agree === false"
							color="warning"
							variant="subtle"
							icon="i-heroicons-exclamation-triangle-20-solid"
							class="ml-auto"
						>
							Nameservers disagree
						</UBadge>
					</header>
					<p v-if="result.zone.error" class="text-error px-4 py-4 text-sm">{{ result.zone.error }}</p>
					<div v-else class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead class="text-muted text-xs uppercase">
								<tr class="border-default border-b">
									<th scope="col" class="px-4 py-2 font-semibold">Nameserver</th>
									<th scope="col" class="px-2 py-2 font-semibold">Result</th>
									<th scope="col" class="px-2 py-2 font-semibold">Answer</th>
									<th scope="col" class="px-2 py-2 text-right font-semibold">Serial</th>
									<th scope="col" class="px-4 py-2 text-right font-semibold">Time</th>
								</tr>
							</thead>
							<tbody class="divide-default divide-y">
								<tr v-for="ns in result.zone.nameservers" :key="ns.host" class="align-top">
									<td class="px-4 py-2">
										<div class="text-highlighted font-mono text-xs">{{ ns.host }}</div>
										<div class="text-dimmed font-mono text-xs">{{ ns.ip || '—' }}</div>
									</td>
									<td class="px-2 py-2">
										<UBadge :color="outcome(ns).color" variant="subtle" size="sm">
											{{ outcome(ns).label }}
										</UBadge>
									</td>
									<td class="px-2 py-2 font-mono text-xs break-all">
										<AnswerCell :server="ns" />
									</td>
									<td class="text-muted px-2 py-2 text-right font-mono text-xs tabular-nums">
										{{ ns.serial ?? '—' }}
									</td>
									<td class="text-dimmed px-4 py-2 text-right text-xs whitespace-nowrap tabular-nums">
										{{ ns.durationMs }} ms
									</td>
								</tr>
							</tbody>
						</table>
					</div>
				</section>

				<section class="surface-panel overflow-hidden" aria-labelledby="resolvers-heading">
					<header class="border-default flex flex-wrap items-center gap-2 border-b px-4 py-3">
						<h2 id="resolvers-heading" class="text-highlighted font-semibold">Public resolvers</h2>
						<span class="text-dimmed text-xs">{{ result.resolvers.length }} queried</span>
						<UButton
							size="xs"
							variant="outline"
							color="neutral"
							icon="i-clarity-clipboard-line"
							class="ml-auto"
							@click="copyJson"
						>
							Copy JSON
						</UButton>
					</header>
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead class="text-muted text-xs uppercase">
								<tr class="border-default border-b">
									<th scope="col" class="px-4 py-2 font-semibold">Resolver</th>
									<th scope="col" class="px-2 py-2 font-semibold">Result</th>
									<th scope="col" class="px-2 py-2 font-semibold">Answer</th>
									<th scope="col" class="px-2 py-2 text-right font-semibold">TTL</th>
									<th scope="col" class="px-4 py-2 text-right font-semibold">Time</th>
								</tr>
							</thead>
							<tbody class="divide-default divide-y">
								<tr v-for="resolver in result.resolvers" :key="resolver.id" class="align-top">
									<td class="px-4 py-2">
										<div class="text-highlighted text-xs font-medium">{{ resolver.label }}</div>
										<div class="text-dimmed text-xs">
											{{ resolver.region }} · <span class="font-mono">{{ resolver.ip }}</span>
										</div>
									</td>
									<td class="px-2 py-2">
										<UBadge :color="outcome(resolver).color" variant="subtle" size="sm">
											{{ outcome(resolver).label }}
										</UBadge>
									</td>
									<td class="px-2 py-2 font-mono text-xs break-all">
										<AnswerCell :server="resolver" />
									</td>
									<td class="text-muted px-2 py-2 text-right font-mono text-xs tabular-nums">
										{{ resolver.ttl ?? '—' }}
									</td>
									<td class="text-dimmed px-4 py-2 text-right text-xs whitespace-nowrap tabular-nums">
										{{ resolver.durationMs }} ms
									</td>
								</tr>
							</tbody>
						</table>
					</div>
					<p class="text-dimmed border-default border-t px-4 py-3 text-xs">
						TTL is the time the resolver will keep its current answer; it is only reported for A and AAAA
						records. Need the full record set with DNSSEC flags?
						<NuxtLink :to="lookupLink" class="text-primary underline-offset-2 hover:underline">
							Open this name in DNS Lookup.
						</NuxtLink>
					</p>
				</section>
			</template>
		</section>
	</PageContainer>
</template>

<script setup>
import { defineComponent, h } from 'vue'
import { useIntervalFn } from '@vueuse/core'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA', 'PTR']
const RESOLVER_COUNT = 15
const RECHECK_INTERVAL_MS = 30000

const typeOptions = RECORD_TYPES.map((t) => ({ label: t, value: t }))
const resolverCountLabel = String(RESOLVER_COUNT)

const queryString = (value) => (typeof value === 'string' ? value : '')
const initialType = queryString(route.query.type).toUpperCase()

const name = ref(queryString(route.query.name))
const type = ref(RECORD_TYPES.includes(initialType) ? initialType : 'A')
const expected = ref(queryString(route.query.expected))
const proxied = ref(route.query.proxied === '1')
const loading = ref(false)
const error = ref('')
const inputError = ref('')
const result = ref(null)
const autoRecheck = ref(false)

const zoneParam = computed(() => queryString(route.query.zone))
const backTo = computed(() => (zoneParam.value ? `/zones/${zoneParam.value}/records` : '/zones'))
const backLabel = computed(() => (zoneParam.value ? 'Back to Records' : 'Back to Zones'))

const lookupLink = computed(() => ({
	path: '/tools/dns-lookup',
	query: {
		name: result.value?.name || name.value,
		type: result.value?.type || type.value,
		zone: zoneParam.value || undefined
	}
}))

const checkedAtLabel = computed(() => {
	if (!result.value?.checkedAt) return ''
	return new Date(result.value.checkedAt).toLocaleTimeString('en-GB')
})

const progressPercent = computed(() => {
	const summary = result.value?.summary
	if (!summary || !summary.total) return 0
	return Math.round((summary.matched / summary.total) * 100)
})

const referenceLabel = computed(() => {
	const reference = result.value?.reference
	if (!reference) return ''
	return reference.source === 'expected' ? 'return the expected value' : 'agree with the zone’s nameservers'
})

const verdict = computed(() => {
	const summary = result.value?.summary
	const base = { icon: 'i-heroicons-question-mark-circle', iconClass: 'text-muted', barClass: 'bg-neutral-400' }
	if (!summary) return { ...base, title: '', detail: '' }
	const counts = `${summary.matched} of ${summary.total} resolvers ${referenceLabel.value}.`
	switch (summary.state) {
		case 'propagated':
			return {
				icon: 'i-heroicons-check-circle',
				iconClass: 'text-success',
				barClass: 'bg-success',
				title: 'Propagated everywhere we asked',
				detail: counts
			}
		case 'partial':
			return {
				icon: 'i-heroicons-arrow-path',
				iconClass: 'text-warning',
				barClass: 'bg-warning',
				title: 'Still propagating',
				detail: counts
			}
		case 'none':
			return {
				icon: 'i-heroicons-clock',
				iconClass: 'text-warning',
				barClass: 'bg-warning',
				title: 'Not visible on public resolvers yet',
				detail: counts
			}
		default:
			return {
				...base,
				title: 'Could not judge propagation',
				detail: result.value?.reference
					? 'None of the resolvers answered, so there is nothing to compare.'
					: 'The zone’s nameservers could not be reached and no expected value was given.'
			}
	}
})

const outcome = (server) => {
	if (server.match === true) return { label: 'Up to date', color: 'success' }
	if (server.match === false) {
		return server.ok ? { label: 'Stale', color: 'warning' } : { label: 'Not yet visible', color: 'warning' }
	}
	if (server.ok) return { label: 'Answered', color: 'neutral' }
	if (server.status === 'nxdomain') return { label: 'Name not found', color: 'neutral' }
	if (server.status === 'nodata') return { label: 'No records', color: 'neutral' }
	if (server.status === 'timeout') return { label: 'Timed out', color: 'neutral' }
	if (server.status === 'refused') return { label: 'Refused', color: 'error' }
	if (server.status === 'servfail') return { label: 'Server failure', color: 'error' }
	return { label: 'Error', color: 'error' }
}

const statusText = (server) => {
	if (server.status === 'nxdomain') return 'NXDOMAIN'
	if (server.status === 'nodata') return 'no records of this type'
	if (server.status === 'timeout') return 'no reply within 4 s'
	return server.error || server.status
}

// Answer values as a list, or the failure reason when there is nothing to show.
const AnswerCell = defineComponent({
	props: { server: { type: Object, required: true } },
	setup(props) {
		return () => {
			const { server } = props
			if (server.ok && server.values.length) {
				return h(
					'ul',
					{ class: 'space-y-0.5' },
					server.values.map((value) => h('li', { class: 'text-highlighted' }, value))
				)
			}
			return h('span', { class: 'text-dimmed' }, statusText(server))
		}
	}
})

const formatDuration = (seconds) => {
	if (seconds < 60) return `${seconds} s`
	if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`
	return `${Math.round((seconds / 3600) * 10) / 10} h`
}

const copyJson = async () => {
	try {
		await navigator.clipboard.writeText(JSON.stringify(result.value, null, 2))
		toast.add({
			id: 'copy-propagation' + Date.now(),
			title: 'Copied',
			description: 'Result JSON copied to clipboard',
			icon: 'i-clarity-check-circle-solid',
			color: 'success',
			duration: 2000
		})
	} catch {
		toast.add({
			id: 'copy-propagation-error' + Date.now(),
			title: 'Copy Failed',
			description: 'Clipboard is unavailable in this browser',
			icon: 'i-clarity-warning-solid',
			color: 'error',
			duration: 3000
		})
	}
}

const syncRouteQuery = () => {
	const query = { ...route.query, name: name.value.trim(), type: type.value }
	if (expected.value.trim()) query.expected = expected.value.trim()
	else delete query.expected
	router.replace({ query })
}

const runCheck = async ({ silent = false } = {}) => {
	const trimmed = name.value.trim()
	inputError.value = ''
	if (!trimmed) {
		inputError.value = 'Enter the name to check.'
		return
	}
	if (loading.value) return

	loading.value = true
	error.value = ''
	try {
		const data = await $fetch('/api/dns_propagation', {
			method: 'POST',
			body: { name: trimmed, type: type.value, expected: expected.value.trim() }
		})
		if (!data?.success) throw new Error(data?.errors?.[0]?.message || 'Check failed')
		result.value = data.result
		if (data.result.reverse) type.value = 'PTR'
		syncRouteQuery()
		if (autoRecheck.value && data.result.summary.state === 'propagated') {
			autoRecheck.value = false
			toast.add({
				id: 'propagated' + Date.now(),
				title: 'Propagated',
				description: `${data.result.name} is up to date on every resolver that answered.`,
				icon: 'i-clarity-check-circle-solid',
				color: 'success',
				duration: 5000
			})
		}
	} catch (e) {
		if (!silent) result.value = null
		const message = e?.data?.statusMessage || e?.statusMessage || e?.message || 'Check failed'
		if (e?.statusCode === 400 || e?.data?.statusCode === 400) inputError.value = message
		else error.value = message
	} finally {
		loading.value = false
	}
}

const { pause, resume } = useIntervalFn(() => runCheck({ silent: true }), RECHECK_INTERVAL_MS, { immediate: false })

watch(autoRecheck, (enabled) => {
	if (enabled) resume()
	else pause()
})

watch([name, expected], () => {
	if (inputError.value) inputError.value = ''
})

onMounted(() => {
	if (name.value.trim()) runCheck()
})
</script>
