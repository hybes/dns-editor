<template>
	<div class="flex w-full flex-col items-center">
		<!-- Presets -->
		<div class="mt-2 flex flex-wrap justify-center gap-3">
			<UButtonGroup v-for="name in presets" :key="name">
				<UButton variant="outline" color="warning" @click="applyPreset(name)">{{ name }}</UButton>
				<UButton
					variant="outline"
					color="warning"
					icon="i-heroicons-trash"
					:aria-label="`Delete preset ${name}`"
					@click="removePreset(name)"
				/>
			</UButtonGroup>
			<UButton variant="outline" color="primary" icon="i-heroicons-bookmark" @click="openPresetModal">
				Save Preset
			</UButton>
		</div>

		<h1 class="mt-6 mb-2 text-center text-xl font-semibold">{{ heading }}</h1>

		<div class="border-default m-4 flex w-full flex-col gap-4 rounded-xl border p-6 shadow-xs md:w-3/4 lg:w-1/2">
			<h2 class="mb-2 flex items-center justify-center gap-2 text-lg font-semibold">
				<Icon :name="getRecordTypeIcon(dns.type)" class="text-primary" />
				{{ mode === 'edit' ? 'Edit DNS Record' : 'Create DNS Record' }}
			</h2>

			<div
				v-if="dns.type"
				class="bg-info/10 text-default flex items-start gap-2 rounded-lg p-4 text-left text-sm"
			>
				<UIcon name="i-heroicons-information-circle" class="mt-0.5 shrink-0" />
				<div>
					<p class="font-medium">{{ getDnsTypeDescription(dns.type) }}</p>
					<p class="text-muted mt-1">{{ getDnsTypeHelp(dns.type) }}</p>
				</div>
			</div>

			<UFormField label="Type" name="type">
				<USelect
					v-model="dns.type"
					class="w-full uppercase"
					:items="creatableTypes"
					@update:model-value="onTypeChange"
				/>
			</UFormField>

			<UFormField v-if="dns.type !== 'SRV'" label="Name" name="name" required>
				<UInput
					v-model="dns.name"
					placeholder="@ for root, or a subdomain"
					class="w-full"
					@keydown.enter="submit"
				/>
			</UFormField>

			<!-- SRV builder -->
			<div v-if="dns.type === 'SRV'" class="flex w-full flex-col gap-4">
				<div class="flex items-center justify-center gap-2">
					<USwitch v-model="srv.advancedSrvMode.value" aria-label="Advanced SRV mode" />
					<span class="text-sm">{{ srv.advancedSrvMode.value ? 'Advanced mode' : 'Simple mode' }}</span>
				</div>

				<div v-if="!srv.advancedSrvMode.value" class="flex flex-col gap-3">
					<div class="bg-info/10 rounded-lg p-4 text-sm">
						<p class="mb-2 font-medium">Quick service setup</p>
						<div class="flex flex-wrap gap-2">
							<UButton
								v-for="qp in srv.quickPresets"
								:key="qp.label"
								size="xs"
								variant="soft"
								:color="qp.color"
								@click="srv.loadQuickPreset(qp.serviceProto, qp.port)"
							>
								{{ qp.label }}
							</UButton>
						</div>
					</div>

					<UFormField label="Service" name="srv-service">
						<USelect
							v-model="srv.srvSimpleService.value"
							class="w-full"
							:items="srv.commonServices"
							@update:model-value="srv.updateFromSimple"
						/>
					</UFormField>
				</div>

				<UFormField v-if="srv.advancedSrvMode.value" label="Service" name="srv-service-adv" required>
					<UInput v-model="srv.srvData.value.service" placeholder="_sip" class="w-full" />
				</UFormField>
				<UFormField v-if="srv.advancedSrvMode.value" label="Protocol" name="srv-proto" required>
					<UInput v-model="srv.srvData.value.proto" placeholder="tcp" class="w-full" />
				</UFormField>

				<UFormField label="Host" name="srv-name" required>
					<UInput v-model="srv.srvData.value.name" placeholder="Hostname or subdomain" class="w-full" />
				</UFormField>
				<UFormField label="Target" name="srv-target" required>
					<UInput v-model="srv.srvData.value.target" placeholder="Target hostname" class="w-full" />
				</UFormField>
				<UFormField label="Port" name="srv-port" required>
					<UInput v-model="srv.srvData.value.port" type="number" placeholder="Port" class="w-full" />
				</UFormField>

				<div v-if="srv.advancedSrvMode.value" class="grid grid-cols-2 gap-3">
					<UFormField label="Priority" name="srv-priority">
						<UInput v-model="srv.srvData.value.priority" type="number" class="w-full" />
					</UFormField>
					<UFormField label="Weight" name="srv-weight">
						<UInput v-model="srv.srvData.value.weight" type="number" class="w-full" />
					</UFormField>
				</div>

				<UFormField label="Full name (preview)" name="srv-preview">
					<UInput :model-value="srv.getFullName()" disabled class="text-muted w-full" />
				</UFormField>
			</div>

			<!-- Content -->
			<UFormField v-if="dns.type !== 'SRV'" label="Content" name="content" required>
				<div class="flex items-center gap-2">
					<UInput
						v-if="!multilineContent"
						v-model="dns.content"
						:placeholder="contentPlaceholder"
						class="w-full"
						@keydown.enter="submit"
					/>
					<UTextarea
						v-else
						v-model="dns.content"
						:rows="4"
						:placeholder="contentPlaceholder"
						class="w-full"
					/>
					<UButton
						variant="ghost"
						color="neutral"
						size="xs"
						:icon="multilineContent ? 'i-heroicons-minus-small' : 'i-heroicons-arrows-pointing-out'"
						:aria-label="multilineContent ? 'Single line input' : 'Multi-line input'"
						@click="multilineContent = !multilineContent"
					/>
				</div>
			</UFormField>

			<UFormField label="TTL" name="ttl">
				<USelect v-model="dns.ttl" class="w-full" :items="ttlOptions" />
			</UFormField>

			<UFormField v-if="dns.type === 'MX'" label="Priority" name="priority">
				<UInput v-model="dns.priority" type="number" placeholder="Priority (e.g. 10)" class="w-full" />
			</UFormField>

			<UFormField v-if="proxiable" label="Proxied through Cloudflare" name="proxied">
				<USwitch v-model="dns.proxied" color="warning" />
			</UFormField>

			<UFormField label="Comment" name="comment">
				<UInput v-model="dns.comment" placeholder="Optional note" class="w-full" @keydown.enter="submit" />
			</UFormField>

			<div class="mt-2 flex justify-center gap-4">
				<UButton
					color="success"
					variant="outline"
					:loading="submitting"
					:disabled="submitting || !canSubmit"
					@click="submit"
				>
					{{ mode === 'edit' ? 'Save' : 'Create' }}
				</UButton>
				<UButton
					v-if="mode === 'edit'"
					color="error"
					variant="outline"
					:disabled="submitting"
					@click="$emit('delete')"
				>
					Delete
				</UButton>
			</div>
		</div>

		<!-- Save preset modal -->
		<UModal v-model:open="presetModalOpen">
			<template #title>Save preset</template>
			<template #body>
				<UFormField label="Preset name" name="preset-name">
					<UInput
						v-model="presetName"
						placeholder="e.g. Google MX"
						autofocus
						class="w-full"
						@keydown.enter="confirmSavePreset"
					/>
				</UFormField>
			</template>
			<template #footer>
				<div class="flex justify-end gap-3">
					<UButton color="neutral" variant="ghost" @click="presetModalOpen = false">Cancel</UButton>
					<UButton color="primary" :disabled="!presetName.trim()" @click="confirmSavePreset">Save</UButton>
				</div>
			</template>
		</UModal>
	</div>
</template>

<script setup>
const props = defineProps({
	mode: { type: String, default: 'create' }, // 'create' | 'edit'
	zoneName: { type: String, default: '' },
	initialRecord: { type: Object, default: null },
	submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['submit', 'delete'])

const toast = useToast()
const { getRecordTypeIcon, getDnsTypeDescription, getDnsTypeHelp, CREATABLE_RECORD_TYPES } = useRecordTypes()
const {
	presets,
	refresh: refreshPresets,
	save: savePreset,
	load: loadPresetData,
	remove: removePresetData
} = useDnsPresets()
const srv = useSrvRecord()

const creatableTypes = CREATABLE_RECORD_TYPES
const ttlOptions = [
	{ label: 'Auto', value: 1 },
	{ label: '1 min', value: 60 },
	{ label: '2 min', value: 120 },
	{ label: '5 min', value: 300 },
	{ label: '10 min', value: 600 },
	{ label: '15 min', value: 900 },
	{ label: '30 min', value: 1800 },
	{ label: '1 hour', value: 3600 },
	{ label: '2 hours', value: 7200 },
	{ label: '12 hours', value: 43200 },
	{ label: '1 day', value: 86400 }
]

const dns = ref({
	name: '',
	type: 'CNAME',
	content: '',
	ttl: 1,
	proxied: false,
	comment: '',
	priority: ''
})
const multilineContent = ref(false)
const presetModalOpen = ref(false)
const presetName = ref('')

const proxiable = computed(() => {
	if (props.mode === 'edit' && props.initialRecord) return props.initialRecord.proxiable === true
	return ['A', 'AAAA', 'CNAME'].includes(dns.value.type)
})

const contentPlaceholder = computed(() => {
	const map = {
		A: 'IPv4 address (e.g. 192.0.2.1)',
		AAAA: 'IPv6 address (e.g. 2606:4700::1)',
		CNAME: 'Target domain',
		MX: 'Mail server hostname',
		NS: 'Name server hostname',
		TXT: 'Text value',
		CAA: 'CA domain (e.g. letsencrypt.org)'
	}
	return map[dns.value.type] || 'Content'
})

const heading = computed(() => {
	if (dns.value.type === 'SRV') return srv.getDisplayName() || props.zoneName
	return props.mode === 'edit' ? dns.value.name || props.zoneName : props.zoneName
})

const canSubmit = computed(() => {
	if (dns.value.type === 'SRV') return srv.isValid()
	return Boolean((dns.value.name || '').trim() && (dns.value.content || '').trim())
})

const onTypeChange = () => {
	if (dns.value.type !== 'A' && dns.value.type !== 'AAAA' && dns.value.type !== 'CNAME') {
		dns.value.proxied = false
	}
}

const openPresetModal = () => {
	presetName.value = ''
	presetModalOpen.value = true
}

const confirmSavePreset = () => {
	const payload = { ...dns.value }
	if (dns.value.type === 'SRV') payload.data = { ...srv.srvData.value }
	// Don't carry instance-specific fields into a reusable preset.
	delete payload.name
	if (savePreset(presetName.value, payload)) {
		toast.add({
			id: `preset-saved-${Date.now()}`,
			title: 'Preset saved',
			icon: 'i-clarity-check-circle-solid',
			color: 'success',
			duration: 2500
		})
		presetModalOpen.value = false
	}
}

const applyPreset = (name) => {
	const data = loadPresetData(name)
	if (!data) return
	if (data.type === 'SRV' && data.data) {
		dns.value.type = 'SRV'
		srv.loadFromRecord({ data: data.data })
	} else {
		dns.value = { ...dns.value, ...data, name: dns.value.name }
	}
}

const removePreset = (name) => {
	removePresetData(name)
	toast.add({
		id: `preset-removed-${Date.now()}`,
		title: 'Preset deleted',
		icon: 'i-clarity-check-circle-solid',
		color: 'neutral',
		duration: 2000
	})
}

const submit = () => {
	if (!canSubmit.value) {
		toast.add({
			id: `validation-${Date.now()}`,
			title: 'Missing required fields',
			description:
				dns.value.type === 'SRV' ? 'Fill in service, host, target and port.' : 'Name and content are required.',
			icon: 'i-clarity-warning-solid',
			color: 'error',
			duration: 3000
		})
		return
	}

	const ttl = Number(dns.value.ttl) || 1

	if (dns.value.type === 'SRV') {
		emit('submit', {
			type: 'SRV',
			srv: { ...srv.srvData.value },
			srvFullName: srv.getFullName(),
			ttl,
			comment: dns.value.comment || '',
			priority: dns.value.priority
		})
		return
	}

	emit('submit', {
		type: dns.value.type,
		name: dns.value.name,
		content: dns.value.content,
		ttl,
		proxied: proxiable.value ? dns.value.proxied : false,
		comment: dns.value.comment || '',
		priority: dns.value.priority
	})
}

const hydrateFromRecord = (record) => {
	if (!record) return
	dns.value = {
		name: record.name || '',
		type: record.type || 'CNAME',
		content: record.content || '',
		ttl: record.ttl ?? 1,
		proxied: Boolean(record.proxied),
		comment: record.comment || '',
		priority: record.priority ?? ''
	}
	if (record.type === 'SRV') srv.loadFromRecord(record)
	if ((record.content || '').includes('\n')) multilineContent.value = true
}

watch(
	() => props.initialRecord,
	(record) => hydrateFromRecord(record),
	{ immediate: true }
)

onMounted(() => {
	refreshPresets()
})

defineExpose({ dns })
</script>
