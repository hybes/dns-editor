<template>
	<PageContainer>
		<div class="mb-2 flex items-center justify-start">
			<UButton variant="outline" icon="i-clarity-undo-line" @click="goBack">Back</UButton>
		</div>

		<Loader
			v-if="loading && !appBootLoading"
			fullscreen
			title="Loading DNS record"
			subtitle="Fetching record details from Cloudflare…"
		/>
		<DnsRecordForm
			v-else
			mode="edit"
			:zone-name="record.zone_name || zoneId"
			:initial-record="record"
			:submitting="submitting"
			@submit="saveRecord"
			@delete="openDeleteModal"
		/>

		<UModal v-model:open="deleteModalOpen">
			<template #title>
				<div class="flex items-center gap-2">
					<UIcon name="i-heroicons-exclamation-triangle" class="h-5 w-5 text-red-500" />
					<span>Delete record</span>
				</div>
			</template>
			<template #description>
				<p class="text-muted text-sm">
					This will permanently delete
					<span class="font-semibold">{{ deleteLabel }}</span>
					from <span class="font-semibold">{{ record.zone_name || zoneId }}</span
					>.
				</p>
			</template>
			<template #body>
				<p class="text-muted text-xs">This action cannot be undone.</p>
			</template>
			<template #footer>
				<div class="flex justify-end gap-3">
					<UButton color="neutral" variant="ghost" @click="deleteModalOpen = false">Cancel</UButton>
					<UButton color="error" :loading="deleteLoading" @click="confirmDelete">Delete</UButton>
				</div>
			</template>
		</UModal>
	</PageContainer>
</template>

<script setup>
const appBootLoading = useState('appBootLoading')
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { getApiKey } = useSession()

const zoneId = computed(() => route.params.zone_id)
const recordId = computed(() => route.params.record_id)
const apiKey = ref('')
const record = ref({})
const loading = ref(true)
const submitting = ref(false)
const deleteModalOpen = ref(false)
const deleteLoading = ref(false)

const dnsRequestBody = computed(() => ({
	apiKey: apiKey.value,
	currZone: zoneId.value,
	currDnsRecord: recordId.value
}))
const {
	data: dnsRecordData,
	error: dnsRecordError,
	refresh: refreshDnsRecord
} = useFetch('/api/dns_record', {
	method: 'POST',
	body: dnsRequestBody,
	server: false,
	immediate: false
})

const seoLabel = computed(() => record.value?.name || recordId.value || 'DNS Record')
useDynamicSeo({
	title: computed(() => `Edit ${seoLabel.value}`),
	description: computed(() => `Edit DNS record ${seoLabel.value}.`)
})

const deleteLabel = computed(() => record.value?.name || recordId.value)

const getRecord = async () => {
	try {
		await refreshDnsRecord()
		if (dnsRecordError.value) throw dnsRecordError.value
		record.value = dnsRecordData.value?.result || {}
	} catch (error) {
		toast.add({
			id: `get-record-error-${Date.now()}`,
			title: 'Error',
			description: error?.data?.statusMessage || error?.message || 'Failed to fetch DNS record',
			icon: 'i-clarity-warning-solid',
			duration: 3000,
			color: 'error'
		})
		router.push(`/zones/${zoneId.value}/records`)
	} finally {
		loading.value = false
	}
}

const saveRecord = async (form) => {
	submitting.value = true
	const dns = { type: form.type, ttl: form.ttl, comment: form.comment }

	if (form.type === 'SRV') {
		const { service, proto, name, target, port, priority, weight } = form.srv
		dns.name = form.srvFullName
		dns.data = { service, proto, name, target, port, priority, weight }
	} else {
		dns.name = form.name
		dns.content = form.content
		dns.proxied = form.proxied
		if (form.type === 'MX') dns.priority = form.priority
	}

	try {
		const data = await $fetch('/api/update_record', {
			method: 'POST',
			body: { apiKey: apiKey.value, currZone: zoneId.value, currDnsRecord: recordId.value, dns }
		})
		if (data?.success === true) {
			toast.add({
				id: `update-record-success-${Date.now()}`,
				title: 'Record updated',
				icon: 'i-clarity-check-circle-solid',
				duration: 3000,
				color: 'success'
			})
			localStorage.setItem(recordsUpdatedKey(zoneId.value), String(Date.now()))
		} else {
			toast.add({
				id: `update-record-error-${Date.now()}`,
				title: 'Update failed',
				description: data?.errors?.[0]?.message || 'Cloudflare rejected the change',
				icon: 'i-clarity-warning-solid',
				duration: 4000,
				color: 'error'
			})
		}
	} catch (error) {
		toast.add({
			id: `update-record-error-${Date.now()}`,
			title: 'Update failed',
			description: error?.data?.statusMessage || error?.message || 'Failed to update record',
			icon: 'i-clarity-warning-solid',
			duration: 4000,
			color: 'error'
		})
	} finally {
		submitting.value = false
	}
}

const openDeleteModal = () => {
	deleteModalOpen.value = true
}

const confirmDelete = async () => {
	deleteLoading.value = true
	try {
		const data = await $fetch('/api/delete_record', {
			method: 'POST',
			body: { apiKey: apiKey.value, currZone: zoneId.value, currDnsRecord: recordId.value }
		})
		if (data?.success !== false) {
			localStorage.setItem(recordsUpdatedKey(zoneId.value), String(Date.now()))
			toast.add({
				id: `delete-record-success-${Date.now()}`,
				title: 'Record deleted',
				icon: 'i-clarity-check-circle-solid',
				duration: 3000,
				color: 'success'
			})
			router.push(`/zones/${zoneId.value}/records`)
		}
	} catch (error) {
		toast.add({
			id: `delete-record-error-${Date.now()}`,
			title: 'Delete failed',
			description: error?.data?.statusMessage || error?.message || 'Failed to delete record',
			icon: 'i-clarity-warning-solid',
			duration: 4000,
			color: 'error'
		})
	} finally {
		deleteLoading.value = false
		deleteModalOpen.value = false
	}
}

const goBack = () => {
	if (route.query.return) {
		try {
			const returnQuery = JSON.parse(decodeURIComponent(route.query.return))
			router.push({ path: `/zones/${zoneId.value}/records`, query: returnQuery })
			return
		} catch {
			// fall through
		}
	}
	router.push(`/zones/${zoneId.value}/records`)
}

onMounted(() => {
	apiKey.value = getApiKey()
	if (!apiKey.value) return
	localStorage.setItem(STORAGE_KEYS.zoneId, zoneId.value)
	localStorage.setItem(STORAGE_KEYS.dnsId, recordId.value)
	getRecord()
})
</script>
