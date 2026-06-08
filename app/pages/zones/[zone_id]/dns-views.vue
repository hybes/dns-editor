<template>
	<PageContainer>
		<Head>
			<Title>DNS Views</Title>
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
				<p class="text-sm text-stone-600 dark:text-stone-400">Internal DNS views</p>
			</div>

			<div class="w-full rounded-xl border border-stone-300 p-6 dark:border-stone-700">
				<div v-if="!canDnsViews" class="text-sm text-stone-700 dark:text-stone-200">
					DNS Views are unavailable for this token/zone.
				</div>

				<div v-else class="flex flex-col gap-4">
					<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div class="flex flex-col gap-1">
							<span class="text-sm font-medium text-stone-700 dark:text-stone-200">Action</span>
							<USelect v-model="action" :items="actions" />
						</div>
						<div class="flex flex-col gap-1">
							<span class="text-sm font-medium text-stone-700 dark:text-stone-200">View ID</span>
							<UInput v-model="viewId" placeholder="For get/update/delete" />
						</div>
						<div class="flex items-end">
							<UButton color="primary" variant="outline" :loading="loading" @click="run"> Run </UButton>
						</div>
					</div>

					<div class="flex flex-col gap-1">
						<span class="text-sm font-medium text-stone-700 dark:text-stone-200">Payload (JSON)</span>
						<UTextarea v-model="payload" :rows="10" placeholder="{}" />
					</div>

					<div v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</div>

					<div v-if="result" class="flex flex-col gap-2">
						<div class="flex justify-end">
							<UButton
								size="xs"
								variant="outline"
								color="neutral"
								icon="i-clarity-clipboard-line"
								@click="copyResult"
							>
								Copy JSON
							</UButton>
						</div>
						<pre
							class="max-h-[520px] overflow-auto rounded-lg bg-stone-100 p-4 text-xs dark:bg-stone-950"
							>{{ result }}</pre
						>
					</div>
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
const canDnsViews = computed(() => Boolean(capabilities.value?.dnsViews?.available))

const actions = ['list', 'create', 'get', 'update', 'delete']
const action = ref('list')
const viewId = ref('')
const payload = ref('{}')

const loading = ref(false)
const error = ref('')
const result = ref('')
const toast = useToast()

const copyResult = async () => {
	if (!result.value) return
	try {
		await navigator.clipboard.writeText(result.value)
		toast.add({
			id: 'copy-result' + Date.now(),
			title: 'Copied',
			description: 'Result copied to clipboard',
			icon: 'i-clarity-check-circle-solid',
			color: 'success',
			duration: 2000
		})
	} catch {
		error.value = 'Clipboard is unavailable in this browser'
	}
}

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

const run = async () => {
	error.value = ''
	result.value = ''
	loading.value = true
	try {
		let parsed = {}
		if (payload.value && payload.value.trim()) parsed = JSON.parse(payload.value)

		let endpoint = '/api/dns_views'
		const body = { apiKey: apiKey.value, currZone: zoneId.value, action: action.value }

		if (action.value === 'get' || action.value === 'update' || action.value === 'delete') {
			endpoint = '/api/dns_view'
			body.viewId = viewId.value
			if (action.value === 'update') body.view = parsed
		} else if (action.value === 'create') {
			body.view = parsed
		}

		const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify(body) })
		const data = await res.json()
		if (!res.ok || data?.success === false) {
			error.value = data?.errors?.[0]?.message || `HTTP ${res.status}`
			return
		}
		result.value = JSON.stringify(data, null, 2)
	} catch (e) {
		error.value = e.message || 'Unknown error'
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
