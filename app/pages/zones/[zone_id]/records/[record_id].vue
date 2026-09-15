<template>
	<div class="contents">
		<USlideover
			:open="open"
			:dismissible="!busy"
			:close="!busy"
			:ui="{ content: 'sm:max-w-xl', wrapper: 'min-w-0 flex-1 pe-8', footer: 'flex-col items-stretch gap-3' }"
			@update:open="onOpenChange"
			@after:leave="returnToList"
		>
			<template #title>
				<span class="flex min-w-0 items-center gap-2">
					<UBadge
						v-if="record"
						:label="record.type"
						:color="getRecordTypeColor(record.type)"
						variant="subtle"
						class="shrink-0 font-mono"
					/>
					<span class="truncate">{{ record ? record.name : 'DNS record' }}</span>
				</span>
			</template>

			<template #body>
				<div class="flex flex-col gap-5">
					<UAlert
						v-if="loadError"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						:title="
							record ? 'Couldn’t load the latest version of this record' : 'Couldn’t load this record'
						"
						:description="loadError"
						:actions="[
							{
								label: 'Try again',
								icon: 'i-lucide-refresh-cw',
								color: 'neutral',
								variant: 'outline',
								loading: fetching,
								onClick: fetchRecord
							}
						]"
					/>

					<UAlert
						v-if="newerVersion"
						color="warning"
						variant="subtle"
						icon="i-lucide-triangle-alert"
						title="This record changed in Cloudflare"
						description="A newer version was saved while you were editing. Saving now replaces it with your changes."
						:actions="[
							{
								label: 'Discard my changes and reload',
								color: 'neutral',
								variant: 'outline',
								onClick: loadNewerVersion
							}
						]"
					/>

					<DnsRecordForm
						v-if="record && editable"
						ref="form"
						v-model:dirty="dirty"
						:form-id="FORM_ID"
						:record="record"
						:zone-name="zoneName"
						:disabled="saving || deleting"
						@submit="save"
					/>

					<template v-else-if="record">
						<UAlert
							color="neutral"
							variant="subtle"
							icon="i-lucide-info"
							:title="`${record.type} records can’t be edited here`"
							description="Change this record in the Cloudflare dashboard. You can still delete it here."
							:actions="dashboardActions"
						/>
						<dl class="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
							<dt class="text-muted">Content</dt>
							<dd class="text-highlighted font-mono break-all">{{ formatContent(record) || '—' }}</dd>
							<dt class="text-muted">TTL</dt>
							<dd class="text-default">{{ formatTtl(record.ttl, { style: 'long' }) || '—' }}</dd>
							<template v-if="record.comment">
								<dt class="text-muted">Comment</dt>
								<dd class="text-default break-words">{{ record.comment }}</dd>
							</template>
						</dl>
					</template>

					<div v-else-if="fetching" class="flex flex-col gap-5" role="status" aria-label="Loading record">
						<div v-for="row in 4" :key="row" class="flex flex-col gap-2">
							<USkeleton class="h-4 w-24" />
							<USkeleton class="h-8 w-full" />
						</div>
					</div>
				</div>
			</template>

			<template #footer>
				<UAlert
					v-if="saveError"
					role="alert"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					title="Couldn’t save the record"
					:description="saveError"
				/>
				<div class="flex items-center gap-2">
					<UButton
						v-if="record"
						label="Delete"
						icon="i-lucide-trash-2"
						color="error"
						variant="ghost"
						:aria-label="`Delete record ${record.name}`"
						:disabled="saving"
						@click="openDelete"
					/>
					<div class="ms-auto flex gap-2">
						<UButton
							:label="editable ? 'Cancel' : 'Close'"
							color="neutral"
							variant="ghost"
							:disabled="busy"
							@click="requestClose"
						/>
						<UButton
							v-if="editable"
							type="submit"
							:form="FORM_ID"
							label="Save changes"
							:loading="saving"
							:disabled="!dirty || deleting"
						/>
					</div>
				</div>
			</template>
		</USlideover>

		<UModal
			v-if="record"
			v-model:open="deleteOpen"
			title="Delete record?"
			:dismissible="!deleting"
			:close="!deleting"
		>
			<template #body>
				<div class="flex flex-col gap-4">
					<p class="text-default text-sm">
						This permanently removes
						<span class="text-highlighted font-mono break-all">{{ recordLabel }}</span>
						from {{ zoneName || 'this zone' }}.
					</p>
					<UAlert
						v-if="deleteError"
						role="alert"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						title="Couldn’t delete the record"
						:description="deleteError"
					/>
				</div>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						label="Cancel"
						color="neutral"
						variant="ghost"
						:disabled="deleting"
						@click="deleteOpen = false"
					/>
					<UButton
						label="Delete record"
						icon="i-lucide-trash-2"
						color="error"
						:loading="deleting"
						@click="confirmDelete"
					/>
				</div>
			</template>
		</UModal>
	</div>
</template>

<script setup>
import { useEventListener } from '@vueuse/core'

const FORM_ID = 'record-edit-form'

const route = useRoute()
const router = useRouter()
const zoneId = computed(() => String(route.params.zone_id || ''))
const recordId = computed(() => String(route.params.record_id || ''))

const { zoneName, accountId, load: loadZone } = useZone(zoneId)
const { findRecord, upsert, remove } = useZoneRecords(zoneId)
const { getRecordTypeColor, formatContent, formatTtl } = useRecordTypes()
const { call } = useCfApi()
const notify = useNotify()

const form = useTemplateRef('form')
const open = ref(true)
const dirty = ref(false)
let leaving = false

// Render straight away from the records list, then replace it with Cloudflare's latest copy.
const record = ref(findRecord(recordId.value))
const fetching = ref(false)
const loadError = ref('')
const newerVersion = ref(null)

const saving = ref(false)
const saveError = ref('')
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteError = ref('')
// While a save or delete is in flight the panel stays open: closing it wouldn't stop the change.
const busy = computed(() => saving.value || deleting.value)

const editable = computed(() => Boolean(record.value && CREATABLE_RECORD_TYPES.includes(record.value.type)))
const recordLabel = computed(() => (record.value ? `${record.value.type} ${record.value.name}` : ''))

const dashboardActions = computed(() =>
	accountId.value && zoneName.value
		? [
				{
					label: 'Open in Cloudflare',
					icon: 'i-lucide-external-link',
					color: 'neutral',
					variant: 'outline',
					to: `https://dash.cloudflare.com/${accountId.value}/${zoneName.value}/dns/records`,
					target: '_blank'
				}
			]
		: undefined
)

useSeoMeta({
	title: () => [recordLabel.value || 'DNS record', zoneName.value].filter(Boolean).join(' · ')
})

let latestRequest = 0

const fetchRecord = async () => {
	const request = ++latestRequest
	fetching.value = true
	loadError.value = ''
	try {
		const response = await call(
			'dns_record',
			{ currZone: zoneId.value, currDnsRecord: recordId.value },
			{ fallback: 'Couldn’t load this record' }
		)
		if (request !== latestRequest || !response?.result) return
		const latest = response.result
		upsert(latest)
		// Don't overwrite edits in progress; offer the newer version instead.
		if (dirty.value && record.value && latest.modified_on !== record.value.modified_on) {
			newerVersion.value = latest
		} else if (!dirty.value) {
			record.value = latest
		}
	} catch (error) {
		if (request === latestRequest) loadError.value = describeError(error, 'Couldn’t load this record')
	} finally {
		if (request === latestRequest) fetching.value = false
	}
}

// Ends a load still in flight, so its older copy can't be written back over a save or delete.
const abandonFetch = () => {
	latestRequest++
	fetching.value = false
}

onBeforeUnmount(() => {
	latestRequest++
})

const loadNewerVersion = () => {
	record.value = newerVersion.value
	newerVersion.value = null
}

// The list may finish loading before Cloudflare answers for this one record.
watch(
	() => findRecord(recordId.value),
	(listed) => {
		if (listed && !record.value) record.value = listed
	}
)

watch(recordId, () => {
	// The route guard has already confirmed discarding; the form may not remount to reset this.
	dirty.value = false
	record.value = findRecord(recordId.value)
	newerVersion.value = null
	saveError.value = ''
	fetchRecord()
})

const confirmDiscard = () => (dirty.value && form.value ? form.value.confirmDiscard() : Promise.resolve(true))

const close = () => {
	leaving = true
	open.value = false
}

const requestClose = async () => {
	if (busy.value) return
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

onBeforeRouteLeave(() => (leaving ? true : busy.value ? false : confirmDiscard()))
onBeforeRouteUpdate((to, from) => {
	if (leaving || to.params.record_id === from.params.record_id) return true
	return busy.value ? false : confirmDiscard()
})

useEventListener(window, 'beforeunload', (event) => {
	if (dirty.value && !leaving) event.preventDefault()
})

const save = async (dns) => {
	abandonFetch()
	saving.value = true
	saveError.value = ''
	try {
		const response = await call(
			'update_record',
			{ currZone: zoneId.value, currDnsRecord: recordId.value, dns },
			{ fallback: 'Cloudflare didn’t save the record' }
		)
		if (response?.result) {
			upsert(response.result)
			record.value = response.result
		}
		newerVersion.value = null
		notify.success('Record saved', response?.result?.name)
		close()
	} catch (error) {
		saveError.value = describeError(error, 'Cloudflare didn’t save the record')
	} finally {
		saving.value = false
	}
}

const openDelete = () => {
	deleteError.value = ''
	deleteOpen.value = true
}

const confirmDelete = async () => {
	abandonFetch()
	deleting.value = true
	deleteError.value = ''
	try {
		await call(
			'delete_record',
			{ currZone: zoneId.value, currDnsRecord: recordId.value },
			{ fallback: 'Cloudflare didn’t delete the record' }
		)
		remove(recordId.value)
		notify.success('Record deleted', record.value?.name)
		deleteOpen.value = false
		close()
	} catch (error) {
		deleteError.value = describeError(error, 'Cloudflare didn’t delete the record')
	} finally {
		deleting.value = false
	}
}

onMounted(() => {
	loadZone()
	fetchRecord()
})
</script>
