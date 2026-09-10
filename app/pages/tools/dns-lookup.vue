<template>
	<PageContainer>
		<Head>
			<Title>DNS Lookup</Title>
		</Head>

		<section aria-labelledby="dns-lookup-title" class="mx-auto flex w-full max-w-5xl flex-col gap-6">
			<UButton :to="backTo" variant="ghost" color="neutral" icon="i-clarity-undo-line" class="self-start">
				{{ backLabel }}
			</UButton>

			<header>
				<p class="text-primary text-xs font-semibold tracking-wide uppercase">Tools</p>
				<h1
					id="dns-lookup-title"
					class="text-highlighted mt-1 text-2xl font-semibold tracking-tight sm:text-3xl"
				>
					DNS Lookup
				</h1>
				<p class="text-muted mt-2 max-w-2xl text-sm">
					Ask Cloudflare’s and Google’s public resolvers what they currently return for a name. Handy for
					confirming that a record change has propagated.
				</p>
			</header>

			<form class="surface-panel flex flex-col gap-4 p-4 sm:p-6" @submit.prevent="runLookup()">
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_13rem]">
					<UFormField
						label="Name or IP address"
						name="lookup-name"
						:error="inputError || undefined"
						class="sm:col-span-2 lg:col-span-1"
					>
						<UInput
							id="lookup-name"
							v-model="name"
							size="lg"
							icon="i-heroicons-globe-alt"
							placeholder="example.com, _dmarc.example.com or 1.1.1.1"
							autocomplete="off"
							autocapitalize="off"
							:spellcheck="false"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Record type" name="lookup-type">
						<USelect
							v-model="type"
							:items="typeOptions"
							size="lg"
							class="w-full"
							aria-label="Record type"
						/>
					</UFormField>
					<UFormField label="Resolvers" name="lookup-resolvers">
						<USelect
							v-model="resolverChoice"
							:items="resolverOptions"
							size="lg"
							class="w-full"
							aria-label="Resolvers to query"
						/>
					</UFormField>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-3">
					<p class="text-muted text-xs">
						Enter an IP address to run a reverse (PTR) lookup. Answers are fetched live, not cached.
					</p>
					<UButton
						type="submit"
						color="primary"
						size="lg"
						icon="i-heroicons-magnifying-glass-20-solid"
						:loading="loading"
						:disabled="!name.trim()"
					>
						Look Up
					</UButton>
				</div>
			</form>

			<div v-if="recentLookups.length" class="flex flex-wrap items-center gap-2">
				<span class="text-muted text-xs font-semibold tracking-wide uppercase">Recent</span>
				<UButton
					v-for="item in recentLookups"
					:key="`${item.name}|${item.type}`"
					size="xs"
					variant="soft"
					color="neutral"
					class="font-mono"
					@click="applyRecent(item)"
				>
					{{ item.name }}
					<span class="text-dimmed">{{ item.type === 'ALL' ? 'all' : item.type }}</span>
				</UButton>
				<UButton
					size="xs"
					variant="ghost"
					color="neutral"
					icon="i-heroicons-x-mark-20-solid"
					aria-label="Clear recent lookups"
					@click="clearRecent"
				/>
			</div>

			<UAlert
				v-if="error"
				color="error"
				variant="subtle"
				icon="i-heroicons-exclamation-triangle"
				title="Lookup Failed"
				:description="error"
			/>

			<template v-if="result">
				<div class="flex flex-wrap items-center gap-2" aria-live="polite">
					<span class="text-highlighted font-mono text-sm font-semibold break-all">{{ result.name }}</span>
					<UBadge color="neutral" variant="subtle">{{ typeLabel }}</UBadge>
					<UBadge v-if="result.reverse" color="info" variant="subtle"
						>Reverse lookup for {{ result.input }}</UBadge
					>
					<UBadge
						v-if="result.agreement.compared"
						:color="result.agreement.matches ? 'success' : 'warning'"
						variant="subtle"
						:icon="
							result.agreement.matches
								? 'i-heroicons-check-circle-20-solid'
								: 'i-heroicons-exclamation-triangle-20-solid'
						"
					>
						{{ result.agreement.matches ? 'Resolvers agree' : 'Resolvers differ' }}
					</UBadge>
					<div class="ml-auto flex flex-wrap items-center gap-2">
						<UButton
							size="xs"
							variant="outline"
							color="neutral"
							icon="i-heroicons-signal"
							:to="propagationLink"
						>
							Check Propagation
						</UButton>
						<UButton
							size="xs"
							variant="outline"
							color="neutral"
							icon="i-clarity-clipboard-line"
							@click="copyText(JSON.stringify(result, null, 2), 'Result JSON')"
						>
							Copy JSON
						</UButton>
					</div>
				</div>

				<div class="grid gap-4" :class="result.resolvers.length > 1 ? 'xl:grid-cols-2' : ''">
					<section
						v-for="resolver in result.resolvers"
						:key="resolver.id"
						class="surface-panel flex min-w-0 flex-col overflow-hidden"
						:aria-label="`${resolver.label} results`"
					>
						<header class="border-default flex flex-wrap items-center gap-2 border-b px-4 py-3">
							<h2 class="text-highlighted font-semibold">{{ resolver.label }}</h2>
							<span class="text-dimmed font-mono text-xs">{{ resolver.address }}</span>
							<div class="ml-auto flex flex-wrap items-center gap-2">
								<UBadge v-if="resolver.ok" :color="statusColor(resolver.status)" variant="subtle">
									{{ resolver.status }}
								</UBadge>
								<UBadge
									v-if="resolver.ok && resolver.dnssec"
									color="success"
									variant="subtle"
									icon="i-heroicons-shield-check"
								>
									DNSSEC
								</UBadge>
								<span class="text-dimmed text-xs tabular-nums">{{ resolver.durationMs }} ms</span>
							</div>
						</header>

						<p v-if="!resolver.ok" class="text-error px-4 py-4 text-sm">{{ resolver.error }}</p>

						<template v-else>
							<div v-if="resolver.answers.length" class="overflow-x-auto">
								<table class="w-full text-left text-sm">
									<thead class="text-muted text-xs uppercase">
										<tr class="border-default border-b">
											<th scope="col" class="px-4 py-2 font-semibold">Name</th>
											<th scope="col" class="px-2 py-2 font-semibold">Type</th>
											<th scope="col" class="px-2 py-2 text-right font-semibold">TTL</th>
											<th scope="col" class="px-2 py-2 font-semibold">Data</th>
											<th scope="col" class="px-2 py-2"><span class="sr-only">Copy</span></th>
										</tr>
									</thead>
									<tbody class="divide-default divide-y">
										<tr v-for="(record, index) in resolver.answers" :key="index" class="align-top">
											<td class="text-muted px-4 py-2 font-mono text-xs whitespace-nowrap">
												{{ record.name }}
											</td>
											<td class="px-2 py-2">
												<UBadge
													:color="getRecordTypeColor(record.type)"
													variant="subtle"
													size="sm"
												>
													{{ record.type }}
												</UBadge>
											</td>
											<td class="text-muted px-2 py-2 text-right font-mono text-xs tabular-nums">
												{{ record.ttl ?? '—' }}
											</td>
											<td class="text-highlighted px-2 py-2 font-mono text-xs break-all">
												{{ record.data }}
											</td>
											<td class="px-2 py-1 text-right">
												<UButton
													size="xs"
													variant="ghost"
													color="neutral"
													icon="i-clarity-clipboard-line"
													:aria-label="`Copy ${record.type} value`"
													@click="copyText(record.data, `${record.type} value`)"
												/>
											</td>
										</tr>
									</tbody>
								</table>
							</div>

							<div v-else class="px-4 py-6 text-center">
								<p class="text-highlighted text-sm font-medium">No {{ typeLabel }} records</p>
								<p class="text-muted mt-1 text-xs">{{ emptyReason(resolver) }}</p>
							</div>

							<div v-if="resolver.authority.length" class="border-default border-t px-4 py-3">
								<p class="text-muted text-xs font-semibold tracking-wide uppercase">Authority</p>
								<ul class="mt-1 space-y-1">
									<li
										v-for="(record, index) in resolver.authority"
										:key="index"
										class="text-muted font-mono text-xs break-all"
									>
										{{ record.name || '.' }} {{ record.type }} {{ record.data }}
									</li>
								</ul>
							</div>

							<p v-if="resolver.comment" class="text-dimmed px-4 pb-3 text-xs">{{ resolver.comment }}</p>
						</template>
					</section>
				</div>
			</template>
		</section>
	</PageContainer>
</template>

<script setup>
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { getRecordTypeColor } = useRecordTypes()

const RECORD_TYPES = [
	'A',
	'AAAA',
	'CNAME',
	'MX',
	'NS',
	'TXT',
	'SOA',
	'SRV',
	'CAA',
	'PTR',
	'DS',
	'DNSKEY',
	'HTTPS',
	'SVCB',
	'TLSA',
	'NAPTR'
]
const MAX_RECENT = 8

const typeOptions = [{ label: 'All common', value: 'ALL' }, ...RECORD_TYPES.map((t) => ({ label: t, value: t }))]
const resolverOptions = [
	{ label: 'Cloudflare and Google', value: 'both' },
	{ label: 'Cloudflare (1.1.1.1)', value: 'cloudflare' },
	{ label: 'Google (8.8.8.8)', value: 'google' }
]

const queryString = (value) => (typeof value === 'string' ? value : '')
const initialType = queryString(route.query.type).toUpperCase()

const name = ref(queryString(route.query.name))
const type = ref(initialType === 'ALL' || RECORD_TYPES.includes(initialType) ? initialType : 'A')
const resolverChoice = ref('both')
const loading = ref(false)
const error = ref('')
const inputError = ref('')
const result = ref(null)
const recentLookups = ref([])

const zoneParam = computed(() => queryString(route.query.zone))
const backTo = computed(() => (zoneParam.value ? `/zones/${zoneParam.value}/records` : '/zones'))
const backLabel = computed(() => (zoneParam.value ? 'Back to Records' : 'Back to Zones'))

const propagationLink = computed(() => ({
	path: '/tools/propagation',
	query: {
		name: result.value?.input || name.value,
		type: result.value && result.value.type !== 'ALL' ? result.value.type : 'A',
		zone: zoneParam.value || undefined
	}
}))

const typeLabel = computed(() => {
	if (!result.value) return ''
	return result.value.type === 'ALL' ? 'All common types' : result.value.type
})

const statusColor = (status) => {
	if (status === 'NOERROR') return 'success'
	if (status === 'NXDOMAIN') return 'warning'
	return 'error'
}

const emptyReason = (resolver) => {
	if (resolver.status === 'NXDOMAIN') return 'This resolver reports that the name does not exist.'
	if (resolver.status === 'NOERROR') return 'The name exists but has no records of this type.'
	return `The resolver answered ${resolver.status}.`
}

const copyText = async (text, label) => {
	try {
		await navigator.clipboard.writeText(text)
		toast.add({
			id: 'copy-lookup' + Date.now(),
			title: 'Copied',
			description: `${label} copied to clipboard`,
			icon: 'i-clarity-check-circle-solid',
			color: 'success',
			duration: 2000
		})
	} catch {
		toast.add({
			id: 'copy-lookup-error' + Date.now(),
			title: 'Copy Failed',
			description: 'Clipboard is unavailable in this browser',
			icon: 'i-clarity-warning-solid',
			color: 'error',
			duration: 3000
		})
	}
}

const readRecent = () => {
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.dnsLookupRecent) || '[]')
		return (Array.isArray(parsed) ? parsed : []).filter((item) => item && item.name && item.type)
	} catch {
		return []
	}
}

const rememberLookup = (entry) => {
	const rest = recentLookups.value.filter((item) => item.name !== entry.name || item.type !== entry.type)
	recentLookups.value = [entry, ...rest].slice(0, MAX_RECENT)
	localStorage.setItem(STORAGE_KEYS.dnsLookupRecent, JSON.stringify(recentLookups.value))
}

const clearRecent = () => {
	recentLookups.value = []
	localStorage.removeItem(STORAGE_KEYS.dnsLookupRecent)
}

const applyRecent = (item) => {
	name.value = item.name
	type.value = item.type
	runLookup()
}

const syncRouteQuery = (lookupName) => {
	const query = { ...route.query, name: lookupName, type: type.value }
	router.replace({ query })
}

const runLookup = async () => {
	const trimmed = name.value.trim()
	inputError.value = ''
	if (!trimmed) {
		inputError.value = 'Enter a domain name or IP address.'
		return
	}

	loading.value = true
	error.value = ''
	try {
		const resolvers = resolverChoice.value === 'both' ? ['cloudflare', 'google'] : [resolverChoice.value]
		const data = await $fetch('/api/dns_lookup', {
			method: 'POST',
			body: { name: trimmed, type: type.value, resolvers }
		})
		if (!data?.success) throw new Error(data?.errors?.[0]?.message || 'Lookup failed')
		result.value = data.result
		if (data.result.reverse) type.value = 'PTR'
		rememberLookup({ name: data.result.input, type: data.result.type })
		syncRouteQuery(data.result.input)
	} catch (e) {
		result.value = null
		const message = e?.data?.statusMessage || e?.statusMessage || e?.message || 'Lookup failed'
		if (e?.statusCode === 400 || e?.data?.statusCode === 400) inputError.value = message
		else error.value = message
	} finally {
		loading.value = false
	}
}

watch(name, () => {
	if (inputError.value) inputError.value = ''
})

onMounted(() => {
	recentLookups.value = readRecent()
	if (name.value.trim()) runLookup()
})
</script>
