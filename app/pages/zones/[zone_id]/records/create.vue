<template>
	<div class="contents">
		<USlideover
			:open="open"
			:title="zoneName ? `Add record to ${zoneName}` : 'Add record'"
			:dismissible="!saving"
			:close="!saving"
			:ui="{ content: 'sm:max-w-xl', wrapper: 'min-w-0 flex-1 pe-8', footer: 'flex-col items-stretch gap-3' }"
			@update:open="onOpenChange"
			@after:leave="returnToList"
		>
			<template #body>
				<DnsRecordForm
					ref="form"
					v-model:dirty="dirty"
					:form-id="FORM_ID"
					:zone-name="zoneName"
					:default-type="defaultType"
					:disabled="saving"
					@submit="create"
				/>
			</template>

			<template #footer>
				<UAlert
					v-if="saveError"
					role="alert"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					title="Couldn’t add the record"
					:description="saveError"
				/>
				<div class="flex justify-end gap-2">
					<UButton label="Cancel" color="neutral" variant="ghost" :disabled="saving" @click="requestClose" />
					<UButton type="submit" :form="FORM_ID" label="Add record" :loading="saving" />
				</div>
			</template>
		</USlideover>
	</div>
</template>

<script setup>
import { useEventListener } from '@vueuse/core'

const FORM_ID = 'record-create-form'

const route = useRoute()
const router = useRouter()
const zoneId = computed(() => String(route.params.zone_id || ''))
const { zoneName, load: loadZone } = useZone(zoneId)
const { upsert } = useZoneRecords(zoneId)
const { call } = useCfApi()
const notify = useNotify()

const form = useTemplateRef('form')
const open = ref(true)
const dirty = ref(false)
const saving = ref(false)
const saveError = ref('')
let leaving = false

// The records table's type filter doubles as the starting type when exactly one is selected.
const defaultType = computed(() => {
	const types = String(route.query.types || '')
		.split(',')
		.map((type) => type.trim().toUpperCase())
		.filter(Boolean)
	const type = types.length === 1 ? types[0] : ''
	return CREATABLE_RECORD_TYPES.includes(type) ? type : 'A'
})

useSeoMeta({ title: () => (zoneName.value ? `Add record · ${zoneName.value}` : 'Add record') })

const confirmDiscard = () => (dirty.value && form.value ? form.value.confirmDiscard() : Promise.resolve(true))

const close = () => {
	leaving = true
	open.value = false
}

// A save in flight can't be discarded: it would still land in Cloudflare.
const requestClose = async () => {
	if (saving.value) return
	if (await confirmDiscard()) close()
}

const onOpenChange = (value) => {
	if (!value) requestClose()
}

// Runs once the closing animation finishes. Going back when the panel was opened from the
// list keeps Back from reopening it; otherwise replace, keeping the table's filters.
const returnToList = () => {
	const listPath = `/zones/${zoneId.value}/records`
	const back = window.history.state?.back
	if (typeof back === 'string' && back.split('?')[0] === listPath) router.back()
	else navigateTo({ path: listPath, query: route.query }, { replace: true })
}

onBeforeRouteLeave(() => (leaving ? true : saving.value ? false : confirmDiscard()))

useEventListener(window, 'beforeunload', (event) => {
	if (dirty.value && !leaving) event.preventDefault()
})

const create = async (dns) => {
	saving.value = true
	saveError.value = ''
	try {
		const response = await call(
			'create_record',
			{ currZone: zoneId.value, dns },
			{ fallback: 'Cloudflare didn’t create the record' }
		)
		if (response?.result) upsert(response.result)
		notify.success('Record added', response?.result?.name)
		close()
	} catch (error) {
		saveError.value = describeError(error, 'Cloudflare didn’t create the record')
	} finally {
		saving.value = false
	}
}

onMounted(() => {
	loadZone()
})
</script>
