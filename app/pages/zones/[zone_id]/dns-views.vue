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
				<h1 class="text-highlighted text-center text-2xl font-semibold">
					{{ zoneName || zoneId }}
				</h1>
				<CapabilityIndicator :missing-items="capabilityMissing" />
				<p class="text-muted text-sm">Internal DNS views</p>
			</div>

			<div class="border-default bg-default w-full rounded-xl border p-6">
				<div v-if="!canDnsViews" class="text-toned text-sm">DNS Views are unavailable for this token/zone.</div>

				<div v-else class="flex flex-col gap-4">
					<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div class="flex flex-col gap-1">
							<span class="text-toned text-sm font-medium">Action</span>
							<USelect v-model="action" :items="actions" />
						</div>
						<div class="flex flex-col gap-1">
							<span class="text-toned text-sm font-medium">
								View ID<span v-if="isDeleteAction" class="text-error">*</span>
							</span>
							<UInput v-model="viewId" placeholder="For get/update/delete" />
						</div>
						<div class="flex items-end">
							<UButton
								:color="isDeleteAction ? 'error' : 'primary'"
								:variant="isDeleteAction ? 'solid' : 'outline'"
								:icon="isDeleteAction ? 'i-heroicons-trash-20-solid' : 'i-heroicons-play-20-solid'"
								:loading="loading"
								@click="run"
							>
								{{ isDeleteAction ? 'Delete…' : 'Run' }}
							</UButton>
						</div>
					</div>

					<div class="flex flex-col gap-1">
						<span class="text-toned text-sm font-medium">Payload (JSON)</span>
						<UTextarea v-model="payload" :rows="10" placeholder="{}" />
					</div>

					<div v-if="error" class="text-error text-sm">{{ error }}</div>

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
						<pre class="bg-muted text-default max-h-[520px] overflow-auto rounded-lg p-4 text-xs">{{
							result
						}}</pre>
					</div>
				</div>
			</div>
		</div>

		<UModal v-model:open="deleteModalOpen">
			<template #title>
				<div class="flex items-center gap-2">
					<UIcon name="i-heroicons-exclamation-triangle" class="text-error h-5 w-5" />
					<span>Delete DNS view?</span>
				</div>
			</template>
			<template #description>
				<p class="text-muted text-sm">
					This will permanently delete view
					<span class="text-highlighted font-mono font-semibold">{{ deleteTarget }}</span
					>.
				</p>
			</template>
			<template #body>
				<p class="text-muted text-sm">This action cannot be undone.</p>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-3">
					<UButton color="neutral" variant="ghost" :disabled="loading" @click="closeDeleteModal">
						Cancel
					</UButton>
					<UButton color="error" icon="i-heroicons-trash-20-solid" :loading="loading" @click="confirmDelete">
						Delete View
					</UButton>
				</div>
			</template>
		</UModal>
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
const isDeleteAction = computed(() => action.value === 'delete')

const loading = ref(false)
const error = ref('')
const result = ref('')
const deleteModalOpen = ref(false)
const deleteTarget = ref('')
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

const executeAction = async ({ selectedAction = action.value, targetId = viewId.value } = {}) => {
	error.value = ''
	result.value = ''
	loading.value = true
	try {
		let parsed = {}
		if ((selectedAction === 'create' || selectedAction === 'update') && payload.value && payload.value.trim()) {
			parsed = JSON.parse(payload.value)
		}

		let endpoint = '/api/dns_views'
		const body = { apiKey: apiKey.value, currZone: zoneId.value, action: selectedAction }

		if (selectedAction === 'get' || selectedAction === 'update' || selectedAction === 'delete') {
			endpoint = '/api/dns_view'
			body.viewId = targetId
			if (selectedAction === 'update') body.view = parsed
		} else if (selectedAction === 'create') {
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

const run = async () => {
	if (!isDeleteAction.value) {
		await executeAction()
		return
	}

	error.value = ''
	result.value = ''
	const targetId = viewId.value.trim()
	if (!targetId) {
		error.value = 'Enter a view ID before deleting.'
		return
	}

	deleteTarget.value = targetId
	deleteModalOpen.value = true
}

const closeDeleteModal = () => {
	deleteModalOpen.value = false
	deleteTarget.value = ''
}

const confirmDelete = async () => {
	if (!deleteTarget.value) return
	await executeAction({ selectedAction: 'delete', targetId: deleteTarget.value })
	closeDeleteModal()
}

onMounted(async () => {
	apiKey.value = getApiKey()
	if (!apiKey.value) return
	zoneName.value = localStorage.getItem(STORAGE_KEYS.zoneName) || ''
	await loadCaps()
})
</script>
