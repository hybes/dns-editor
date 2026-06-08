<template>
	<PageContainer>
		<div class="mb-2 flex items-center justify-start">
			<UButton variant="outline" icon="i-clarity-undo-line" @click="goBack">Back</UButton>
		</div>

		<Loader
			v-if="loading && !appBootLoading"
			fullscreen
			title="Preparing record creation"
			subtitle="Fetching zone details from Cloudflare…"
		/>
		<DnsRecordForm
			v-else
			mode="create"
			:zone-name="zone.name || zoneId"
			:submitting="submitting"
			@submit="createRecord"
		/>
	</PageContainer>
</template>

<script setup>
const appBootLoading = useState('appBootLoading')
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { getApiKey } = useSession()

const zoneId = computed(() => route.params.zone_id)
const apiKey = ref('')
const zone = ref({})
const loading = ref(true)
const submitting = ref(false)

const zoneRequestBody = computed(() => ({ apiKey: apiKey.value, currZone: zoneId.value }))
const {
	data: zoneData,
	error: zoneError,
	refresh: refreshZone
} = useFetch('/api/zone', {
	method: 'POST',
	body: zoneRequestBody,
	server: false,
	immediate: false
})

const seoZoneLabel = computed(() => zone.value?.name || zoneId.value || 'Zone')
useDynamicSeo({
	title: computed(() => `Create DNS Record — ${seoZoneLabel.value}`),
	description: computed(() => `Create a DNS record for ${seoZoneLabel.value}.`)
})

const getZone = async () => {
	try {
		await refreshZone()
		if (zoneError.value) throw zoneError.value
		const data = zoneData.value
		if (data?.success) {
			zone.value = data.result
			return
		}
		toast.add({
			id: `get-zone-error-${Date.now()}`,
			title: 'Error',
			description: data?.errors?.[0]?.message || 'Failed to fetch zone information',
			icon: 'i-clarity-warning-solid',
			duration: 3000,
			color: 'error'
		})
		router.push('/zones')
	} catch {
		router.push('/zones')
	} finally {
		loading.value = false
	}
}

const createRecord = async (form) => {
	submitting.value = true
	const body = { apiKey: apiKey.value, currZone: zoneId.value }

	if (form.type === 'SRV') {
		const { service, proto, name, target, port, priority, weight } = form.srv
		body.data = { service, proto, name, target, port, priority, weight }
	} else {
		body.dns = {
			name: form.name,
			type: form.type,
			content: form.content,
			proxied: form.proxied,
			comment: form.comment,
			ttl: form.ttl
		}
		if (form.type === 'MX') body.dns.priority = form.priority
	}

	try {
		const data = await $fetch('/api/create_record', { method: 'POST', body })
		if (data?.success === true) {
			toast.add({
				id: `create-record-success-${Date.now()}`,
				title: 'Record created',
				icon: 'i-clarity-check-circle-solid',
				duration: 3000,
				color: 'success'
			})
			localStorage.setItem(recordsUpdatedKey(zoneId.value), String(Date.now()))
			router.push(`/zones/${zoneId.value}/records`)
		} else {
			toast.add({
				id: `create-record-error-${Date.now()}`,
				title: 'Create failed',
				description: data?.errors?.[0]?.message || 'Cloudflare rejected the record',
				icon: 'i-clarity-warning-solid',
				duration: 4000,
				color: 'error'
			})
		}
	} catch (error) {
		toast.add({
			id: `create-record-error-${Date.now()}`,
			title: 'Create failed',
			description: error?.data?.statusMessage || error?.message || 'Failed to create record',
			icon: 'i-clarity-warning-solid',
			duration: 4000,
			color: 'error'
		})
	} finally {
		submitting.value = false
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
	getZone()
})
</script>
