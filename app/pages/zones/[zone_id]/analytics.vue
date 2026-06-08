<template>
	<PageContainer>
		<Head>
			<Title>Analytics</Title>
		</Head>

		<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
			<UButton variant="outline" icon="i-clarity-undo-line" :to="`/zones/${zoneId}/records`"
				>Back to Records</UButton
			>
		</div>

		<div class="flex flex-col gap-6">
			<div class="flex flex-col items-center justify-center gap-2">
				<h1 class="text-center text-2xl font-semibold text-stone-900 dark:text-stone-100">
					{{ zoneName || zoneId }}
				</h1>
				<CapabilityIndicator :missing-items="capabilityMissing" />
				<p class="text-sm text-stone-600 dark:text-stone-400">Account analytics (GraphQL)</p>
			</div>

			<div class="w-full rounded-xl border border-stone-300 p-6 dark:border-stone-700">
				<div v-if="!canAnalytics" class="text-sm text-stone-700 dark:text-stone-200">
					Account Analytics are unavailable for this token/zone.
				</div>

				<div v-else class="flex flex-col gap-4">
					<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div class="flex flex-col gap-1">
							<span class="text-sm font-medium text-stone-700 dark:text-stone-200">date_geq</span>
							<UInput v-model="dateGeq" placeholder="YYYY-MM-DD" />
						</div>
						<div class="flex flex-col gap-1">
							<span class="text-sm font-medium text-stone-700 dark:text-stone-200">date_leq</span>
							<UInput v-model="dateLeq" placeholder="YYYY-MM-DD" />
						</div>
					</div>

					<div class="flex flex-wrap gap-3">
						<UButton color="primary" variant="outline" :loading="loading" @click="runQuery">
							Run DNS query count
						</UButton>
					</div>

					<div v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</div>

					<pre
						v-if="result"
						class="max-h-[520px] overflow-auto rounded-lg bg-stone-100 p-4 text-xs dark:bg-stone-950"
						>{{ result }}</pre
					>
				</div>
			</div>
		</div>
	</PageContainer>
</template>

<script setup>
const route = useRoute()
const { getApiKey } = useSession()

const apiKey = ref('')
const zoneName = ref('')
const zoneId = computed(() => route.params.zone_id)

const capabilities = ref(null)
const capabilityMissing = ref([])
const canAnalytics = computed(() => Boolean(capabilities.value?.accountAnalytics?.available))

const dateGeq = ref('2025-01-01')
const dateLeq = ref('2025-01-02')

const loading = ref(false)
const error = ref('')
const result = ref('')
const analyticsRequestBody = computed(() => ({
	apiKey: apiKey.value,
	currZone: zoneId.value,
	kind: 'dnsQueryCount',
	range: { date_geq: dateGeq.value, date_leq: dateLeq.value }
}))
const {
	data: analyticsData,
	error: analyticsError,
	refresh: refreshAnalytics
} = useFetch('/api/account_analytics', {
	method: 'POST',
	body: analyticsRequestBody,
	server: false,
	immediate: false
})

const loadCaps = async () => {
	try {
		const { loadZone, missing } = useCapabilities()
		const caps = await loadZone(apiKey.value, zoneId.value)
		capabilities.value = caps
		capabilityMissing.value = missing(caps)
	} catch {
		capabilities.value = null
		capabilityMissing.value = []
	}
}

const runQuery = async () => {
	error.value = ''
	result.value = ''
	loading.value = true
	try {
		await refreshAnalytics()
		if (analyticsError.value) throw analyticsError.value
		const data = analyticsData.value
		if (!data || data?.success === false) {
			error.value = data?.errors?.[0]?.message || 'Failed to load analytics'
			return
		}
		result.value = JSON.stringify(data, null, 2)
	} catch (e) {
		error.value = e?.data?.statusMessage || e?.statusMessage || e?.message || 'Unknown error'
	} finally {
		loading.value = false
	}
}

onMounted(async () => {
	apiKey.value = getApiKey()
	if (!apiKey.value) return
	zoneName.value = localStorage.getItem(STORAGE_KEYS.zoneName) || ''
	await loadCaps()
})
</script>
