<template>
	<div class="flex w-full flex-col items-center">
		<section class="mb-6 w-full max-w-2xl" aria-labelledby="presets-heading">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 id="presets-heading" class="text-highlighted text-sm font-semibold">Saved Presets</h2>
					<p class="text-muted mt-0.5 text-xs">Reuse record settings without carrying over the hostname.</p>
				</div>
				<UButton variant="soft" color="primary" icon="i-heroicons-bookmark" @click="openPresetModal">
					Save as Preset
				</UButton>
			</div>

			<div v-if="presets.length" class="mt-3 flex flex-wrap gap-2">
				<UFieldGroup v-for="name in presets" :key="name">
					<UButton variant="outline" color="neutral" class="max-w-52" @click="applyPreset(name)">
						<span class="truncate">{{ name }}</span>
					</UButton>
					<UButton
						variant="outline"
						color="neutral"
						icon="i-heroicons-trash"
						:aria-label="`Delete preset ${name}`"
						@click="openPresetDeleteModal(name)"
					/>
				</UFieldGroup>
			</div>
		</section>

		<form class="surface-panel w-full max-w-2xl overflow-hidden" novalidate @submit.prevent="submit">
			<header class="border-default border-b px-4 py-5 sm:px-6">
				<div class="flex min-w-0 items-start gap-3">
					<div
						class="bg-primary/10 ring-primary/20 mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1"
					>
						<UIcon :name="getRecordTypeIcon(dns.type)" class="text-primary h-5 w-5" aria-hidden="true" />
					</div>
					<div class="min-w-0">
						<p class="text-primary text-xs font-semibold tracking-wide uppercase">
							{{ mode === 'edit' ? 'Edit Record' : 'New Record' }}
						</p>
						<h1 class="text-highlighted mt-1 text-xl font-semibold tracking-tight break-words sm:text-2xl">
							{{ heading }}
						</h1>
						<p class="text-muted mt-1 text-sm">
							{{
								mode === 'edit'
									? `Update this ${dns.type} record safely.`
									: `Add a record to ${zoneName}.`
							}}
						</p>
					</div>
				</div>
			</header>

			<div class="space-y-5 px-4 py-5 sm:px-6 sm:py-6">
				<div v-if="dns.type" class="bg-info/10 text-default flex items-start gap-3 rounded-lg p-4 text-sm">
					<UIcon
						name="i-heroicons-information-circle"
						class="text-info mt-0.5 h-5 w-5 shrink-0"
						aria-hidden="true"
					/>
					<div class="min-w-0">
						<p class="font-medium">{{ getDnsTypeDescription(dns.type) }}</p>
						<p class="text-muted mt-1 text-pretty">{{ getDnsTypeHelp(dns.type) }}</p>
					</div>
				</div>

				<div class="grid gap-5 sm:grid-cols-[11rem_minmax(0,1fr)]">
					<UFormField label="Type" name="type">
						<USelect
							v-model="dns.type"
							class="w-full uppercase"
							:items="creatableTypes"
							aria-label="DNS record type"
							@update:model-value="onTypeChange"
						/>
					</UFormField>

					<UFormField v-if="dns.type !== 'SRV'" label="Name" name="name" required :error="nameError">
						<UInput
							v-model="dns.name"
							name="record-name"
							autocomplete="off"
							:spellcheck="false"
							placeholder="@ for the root, or a subdomain such as www…"
							class="w-full"
						/>
					</UFormField>
				</div>

				<div v-if="dns.type === 'SRV'" class="space-y-5">
					<div
						class="border-default bg-muted/60 flex items-center justify-between gap-4 rounded-lg border p-3"
					>
						<div>
							<p class="text-highlighted text-sm font-medium">Advanced SRV Mode</p>
							<p class="text-muted text-xs">Enter the service and protocol manually.</p>
						</div>
						<USwitch v-model="srv.advancedSrvMode.value" aria-label="Toggle advanced SRV mode" />
					</div>

					<div v-if="!srv.advancedSrvMode.value" class="space-y-4">
						<div class="bg-info/10 rounded-lg p-4 text-sm">
							<p class="mb-2 font-medium">Quick Service Setup</p>
							<div class="flex flex-wrap gap-2">
								<UButton
									v-for="qp in srv.quickPresets"
									:key="qp.label"
									type="button"
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

					<div v-if="srv.advancedSrvMode.value" class="grid gap-5 sm:grid-cols-2">
						<UFormField label="Service" name="srv-service-advanced" required>
							<UInput
								v-model="srv.srvData.value.service"
								placeholder="For example, _sip…"
								class="w-full"
							/>
						</UFormField>
						<UFormField label="Protocol" name="srv-protocol" required>
							<UInput v-model="srv.srvData.value.proto" placeholder="For example, tcp…" class="w-full" />
						</UFormField>
					</div>

					<div class="grid gap-5 sm:grid-cols-2">
						<UFormField label="Host" name="srv-name" required>
							<UInput
								v-model="srv.srvData.value.name"
								placeholder="Hostname or subdomain…"
								class="w-full"
							/>
						</UFormField>
						<UFormField label="Target" name="srv-target" required>
							<UInput v-model="srv.srvData.value.target" placeholder="Target hostname…" class="w-full" />
						</UFormField>
					</div>

					<div class="grid gap-5 sm:grid-cols-3">
						<UFormField label="Port" name="srv-port" required>
							<UInput v-model="srv.srvData.value.port" type="number" inputmode="numeric" class="w-full" />
						</UFormField>
						<UFormField v-if="srv.advancedSrvMode.value" label="Priority" name="srv-priority">
							<UInput
								v-model="srv.srvData.value.priority"
								type="number"
								inputmode="numeric"
								class="w-full"
							/>
						</UFormField>
						<UFormField v-if="srv.advancedSrvMode.value" label="Weight" name="srv-weight">
							<UInput
								v-model="srv.srvData.value.weight"
								type="number"
								inputmode="numeric"
								class="w-full"
							/>
						</UFormField>
					</div>

					<UFormField label="Full Name Preview" name="srv-preview">
						<UInput :model-value="srv.getFullName()" disabled class="text-muted w-full font-mono text-sm" />
					</UFormField>
				</div>

				<UFormField v-if="dns.type !== 'SRV'" label="Content" name="content" required :error="contentError">
					<div class="relative min-w-0">
						<UInput
							v-if="!multilineContent"
							v-model="dns.content"
							name="record-content"
							autocomplete="off"
							:spellcheck="dns.type === 'TXT'"
							:placeholder="contentPlaceholder"
							class="w-full min-w-0"
							:ui="{ base: 'pe-11' }"
						/>
						<UTextarea
							v-else
							v-model="dns.content"
							name="record-content"
							autocomplete="off"
							:rows="4"
							:placeholder="contentPlaceholder"
							class="w-full min-w-0"
							:ui="{ base: 'pe-11' }"
						/>
						<UButton
							type="button"
							variant="ghost"
							color="neutral"
							size="xs"
							class="absolute top-1.5 right-1.5 shrink-0"
							:icon="multilineContent ? 'i-heroicons-minus-small' : 'i-heroicons-arrows-pointing-out'"
							:aria-label="
								multilineContent ? 'Use a single-line content field' : 'Use a multi-line content field'
							"
							@click="multilineContent = !multilineContent"
						/>
					</div>
				</UFormField>

				<div class="grid gap-5 sm:grid-cols-2">
					<UFormField label="TTL" name="ttl" hint="Auto is recommended">
						<USelect v-model="dns.ttl" class="w-full" :items="ttlOptions" aria-label="Time to live" />
					</UFormField>

					<UFormField v-if="dns.type === 'MX'" label="Priority" name="priority">
						<UInput
							v-model="dns.priority"
							type="number"
							inputmode="numeric"
							placeholder="For example, 10…"
							class="w-full"
						/>
					</UFormField>
				</div>

				<UFormField v-if="proxiable" label="Cloudflare Proxy" name="proxied">
					<div
						class="border-default bg-muted/60 flex items-center justify-between gap-4 rounded-lg border p-3"
					>
						<div>
							<p class="text-highlighted text-sm font-medium">Proxy traffic through Cloudflare</p>
							<p class="text-muted mt-0.5 text-xs">
								Enables Cloudflare performance and security features.
							</p>
						</div>
						<USwitch
							v-model="dns.proxied"
							color="primary"
							aria-label="Proxy this record through Cloudflare"
						/>
					</div>
				</UFormField>

				<UFormField label="Comment" name="comment" hint="Optional">
					<UInput
						v-model="dns.comment"
						name="record-comment"
						autocomplete="off"
						placeholder="Add a note for your team…"
						class="w-full"
					/>
				</UFormField>
			</div>

			<footer
				class="border-default bg-muted/50 flex flex-col-reverse gap-3 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
			>
				<UButton
					v-if="mode === 'edit'"
					type="button"
					color="error"
					variant="ghost"
					icon="i-heroicons-trash-20-solid"
					:disabled="submitting"
					@click="$emit('delete')"
				>
					Delete Record
				</UButton>
				<span v-else />

				<UButton
					type="submit"
					color="primary"
					icon="i-heroicons-check-circle-20-solid"
					:loading="submitting"
					:disabled="submitting"
					class="sm:min-w-36 sm:justify-center"
				>
					{{ mode === 'edit' ? 'Save Changes' : 'Create Record' }}
				</UButton>
			</footer>
		</form>

		<UModal v-model:open="presetModalOpen">
			<template #title>Save Preset</template>
			<template #description>Save the current record settings without the hostname.</template>
			<template #body>
				<form id="save-preset-form" @submit.prevent="confirmSavePreset">
					<UFormField label="Preset Name" name="preset-name" required>
						<UInput
							v-model="presetName"
							name="preset-name"
							autocomplete="off"
							placeholder="For example, Google MX…"
							class="w-full"
						/>
					</UFormField>
				</form>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-3">
					<UButton color="neutral" variant="ghost" @click="presetModalOpen = false">Cancel</UButton>
					<UButton type="submit" form="save-preset-form" color="primary" :disabled="!presetName.trim()">
						Save Preset
					</UButton>
				</div>
			</template>
		</UModal>

		<UModal v-model:open="presetDeleteModalOpen">
			<template #title>Delete Preset?</template>
			<template #description>
				Delete <span class="text-highlighted font-semibold">{{ presetToDelete }}</span> from this browser.
			</template>
			<template #body>
				<p class="text-muted text-sm">This does not affect any existing DNS records.</p>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-3">
					<UButton color="neutral" variant="ghost" @click="presetDeleteModalOpen = false">Cancel</UButton>
					<UButton color="error" @click="confirmRemovePreset">Delete Preset</UButton>
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
const presetDeleteModalOpen = ref(false)
const presetToDelete = ref('')
const attemptedSubmit = ref(false)

const proxiable = computed(() => {
	if (props.mode === 'edit' && props.initialRecord && dns.value.type === props.initialRecord.type) {
		return props.initialRecord.proxiable === true
	}
	return ['A', 'AAAA', 'CNAME'].includes(dns.value.type)
})

const contentPlaceholder = computed(() => {
	const map = {
		A: 'IPv4 address, for example 192.0.2.1…',
		AAAA: 'IPv6 address, for example 2606:4700::1…',
		CNAME: 'Target domain, for example origin.example.com…',
		MX: 'Mail server hostname, for example mail.example.com…',
		NS: 'Name server hostname, for example ns1.example.com…',
		TXT: 'Verification code or text value…',
		CAA: 'CA domain, for example letsencrypt.org…'
	}
	return map[dns.value.type] || 'Record content…'
})

const heading = computed(() => {
	if (dns.value.type === 'SRV') return srv.getDisplayName() || props.zoneName
	return props.mode === 'edit' ? dns.value.name || props.zoneName : props.zoneName
})

const canSubmit = computed(() => {
	if (dns.value.type === 'SRV') return srv.isValid()
	return Boolean((dns.value.name || '').trim() && (dns.value.content || '').trim())
})

const nameError = computed(() => {
	if (!attemptedSubmit.value || dns.value.type === 'SRV' || (dns.value.name || '').trim()) return undefined
	return 'Enter @ for the root domain or a hostname.'
})

const contentError = computed(() => {
	if (!attemptedSubmit.value || dns.value.type === 'SRV' || (dns.value.content || '').trim()) return undefined
	return `Enter the value for this ${dns.value.type} record.`
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

const openPresetDeleteModal = (name) => {
	presetToDelete.value = name
	presetDeleteModalOpen.value = true
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

const confirmRemovePreset = () => {
	if (!presetToDelete.value) return
	removePresetData(presetToDelete.value)
	toast.add({
		id: `preset-removed-${Date.now()}`,
		title: 'Preset Deleted',
		icon: 'i-clarity-check-circle-solid',
		color: 'neutral',
		duration: 2000
	})
	presetDeleteModalOpen.value = false
	presetToDelete.value = ''
}

const submit = () => {
	attemptedSubmit.value = true
	if (!canSubmit.value) {
		toast.add({
			id: `validation-${Date.now()}`,
			title: 'Complete Required Fields',
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
		name: dns.value.name.trim(),
		// Whitespace can be meaningful in TXT records. Validation uses a
		// trimmed value, but Cloudflare should receive exactly what was entered.
		content: dns.value.content,
		ttl,
		proxied: proxiable.value ? dns.value.proxied : false,
		comment: dns.value.comment || '',
		priority: dns.value.priority
	})
}

const hydrateFromRecord = (record) => {
	if (!record) return
	attemptedSubmit.value = false
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
