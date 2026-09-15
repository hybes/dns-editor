<template>
	<form :id="formId" ref="formEl" novalidate @submit.prevent="onSubmit">
		<fieldset :disabled="disabled" class="flex min-w-0 flex-col gap-5">
			<legend class="sr-only">Record details</legend>

			<div class="flex items-end gap-2">
				<UFormField label="Type" :description="typeDef.help" class="min-w-0 flex-1">
					<USelect v-model="state.type" :items="typeItems" class="w-full" />
				</UFormField>
				<UDropdownMenu :items="presetMenu" :content="{ align: 'end' }">
					<UButton
						label="Presets"
						icon="i-lucide-bookmark"
						trailing-icon="i-lucide-chevron-down"
						color="neutral"
						variant="outline"
					/>
				</UDropdownMenu>
			</div>

			<UFormField :label="isSrv ? 'Host' : 'Name'" required :error="errorFor('name')" :help="nameHelp">
				<UInput
					v-model="state.name"
					autocomplete="off"
					autocapitalize="off"
					:spellcheck="false"
					:placeholder="isSrv ? '@' : 'www'"
					class="w-full"
				/>
			</UFormField>

			<template v-if="isSrv">
				<UFormField label="Service" required :error="customService ? undefined : errorFor('service')">
					<USelect
						v-model="serviceChoice"
						:items="serviceItems"
						placeholder="Choose a service"
						class="w-full"
					/>
				</UFormField>

				<div v-if="customService" class="grid gap-5 sm:grid-cols-2">
					<UFormField label="Service name" required :error="errorFor('service')">
						<UInput
							v-model="state.srv.service"
							autocomplete="off"
							autocapitalize="off"
							:spellcheck="false"
							placeholder="_myservice"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Protocol" required :error="errorFor('protocol')">
						<USelect v-model="state.srv.protocol" :items="protocolItems" class="w-full" />
					</UFormField>
				</div>

				<UFormField label="Target" required :error="errorFor('target')">
					<UInput
						v-model="state.srv.target"
						autocomplete="off"
						autocapitalize="off"
						:spellcheck="false"
						placeholder="sip.example.com"
						class="w-full"
					/>
				</UFormField>

				<div class="grid grid-cols-3 gap-3">
					<UFormField label="Priority" required :error="errorFor('srvPriority')">
						<UInput
							v-model="state.srv.priority"
							type="number"
							inputmode="numeric"
							min="0"
							max="65535"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Weight" required :error="errorFor('weight')">
						<UInput
							v-model="state.srv.weight"
							type="number"
							inputmode="numeric"
							min="0"
							max="65535"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Port" required :error="errorFor('port')">
						<UInput
							v-model="state.srv.port"
							type="number"
							inputmode="numeric"
							min="0"
							max="65535"
							class="w-full"
						/>
					</UFormField>
				</div>

				<UFormField label="Full name">
					<UInput
						:model-value="srvPreview"
						readonly
						placeholder="Choose a service and host"
						class="w-full"
						:ui="{ base: 'font-mono' }"
					/>
				</UFormField>
			</template>

			<template v-else-if="isCaa">
				<UFormField label="Tag" required :error="errorFor('tag')">
					<USelect v-model="state.caa.tag" :items="caaTagItems" class="w-full" />
				</UFormField>
				<div class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_7rem]">
					<UFormField label="Value" required :error="errorFor('caaValue')">
						<UInput
							v-model="state.caa.value"
							autocomplete="off"
							autocapitalize="off"
							:spellcheck="false"
							:placeholder="state.caa.tag === 'iodef' ? 'mailto:security@example.com' : 'letsencrypt.org'"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Flags" required help="Usually 0" :error="errorFor('flags')">
						<UInput
							v-model="state.caa.flags"
							type="number"
							inputmode="numeric"
							min="0"
							max="255"
							class="w-full"
						/>
					</UFormField>
				</div>
			</template>

			<div
				v-else
				class="grid gap-5"
				:class="state.type === 'MX' ? 'sm:grid-cols-[minmax(0,1fr)_7rem]' : undefined"
			>
				<UFormField
					:label="typeDef.content.label"
					required
					:error="errorFor('content')"
					:hint="contentHint"
					:help="contentHelp"
				>
					<UTextarea
						v-if="state.type === 'TXT'"
						v-model="state.content"
						autoresize
						:rows="3"
						:maxrows="12"
						autocomplete="off"
						:placeholder="typeDef.content.placeholder"
						class="w-full"
						:ui="{ base: 'font-mono break-all' }"
					/>
					<UInput
						v-else
						v-model="state.content"
						autocomplete="off"
						autocapitalize="off"
						:spellcheck="false"
						:placeholder="typeDef.content.placeholder"
						class="w-full"
					/>
				</UFormField>
				<UFormField v-if="state.type === 'MX'" label="Priority" required :error="errorFor('priority')">
					<UInput
						v-model="state.priority"
						type="number"
						inputmode="numeric"
						min="0"
						max="65535"
						placeholder="10"
						class="w-full"
					/>
				</UFormField>
			</div>

			<div class="grid gap-5 sm:grid-cols-2">
				<UFormField label="TTL" :help="proxied ? 'Proxied records always use Auto.' : undefined">
					<USelect
						:model-value="proxied ? 1 : state.ttl"
						:items="ttlItems"
						:disabled="proxied"
						class="w-full"
						@update:model-value="(value) => (state.ttl = value)"
					/>
				</UFormField>
				<UFormField
					v-if="typeDef.proxiable"
					label="Proxy status"
					:help="
						state.proxied
							? 'Traffic passes through Cloudflare, which hides the origin address.'
							: 'Resolvers get this record’s value directly.'
					"
				>
					<USwitch v-model="state.proxied" label="Proxy through Cloudflare" />
				</UFormField>
			</div>

			<UFormField label="Comment" hint="Optional">
				<UInput v-model="state.comment" autocomplete="off" class="w-full" />
			</UFormField>
		</fieldset>

		<UModal
			v-model:open="savePresetOpen"
			title="Save as preset"
			:description="`Saves this form’s ${state.type} settings without the ${isSrv ? 'host' : 'name'}, so you can reuse them.`"
		>
			<template #body>
				<form :id="`${formId}-preset`" novalidate class="flex flex-col gap-3" @submit.prevent="savePreset">
					<UFormField label="Preset name" required :error="presetError || undefined">
						<UInput v-model="presetName" autocomplete="off" placeholder="Mail servers" class="w-full" />
					</UFormField>
					<UAlert
						v-if="presetExists"
						color="warning"
						variant="subtle"
						icon="i-lucide-triangle-alert"
						:title="`Replace “${presetName.trim()}”?`"
						description="A preset with this name already exists. Saving overwrites it."
					/>
				</form>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton label="Cancel" color="neutral" variant="ghost" @click="savePresetOpen = false" />
					<UButton
						type="submit"
						:form="`${formId}-preset`"
						:label="presetExists ? 'Replace preset' : 'Save preset'"
						:color="presetExists ? 'warning' : 'primary'"
					/>
				</div>
			</template>
		</UModal>

		<UModal
			v-model:open="managePresetsOpen"
			title="Delete presets"
			description="Presets are stored in this browser. Deleting one doesn’t change any DNS records."
		>
			<template #body>
				<p v-if="!presets.length" class="text-muted text-sm">No presets are saved in this browser.</p>
				<ul v-else class="divide-default divide-y">
					<li v-for="name in presets" :key="name" class="flex min-h-11 items-center gap-2 py-1.5">
						<template v-if="pendingPresetDelete === name">
							<span class="text-highlighted min-w-0 flex-1 truncate text-sm">Delete “{{ name }}”?</span>
							<UButton
								label="Cancel"
								size="sm"
								color="neutral"
								variant="ghost"
								@click="pendingPresetDelete = ''"
							/>
							<UButton
								label="Delete"
								size="sm"
								color="error"
								data-preset-confirm
								@click="deletePreset(name)"
							/>
						</template>
						<template v-else>
							<span class="text-default min-w-0 flex-1 truncate text-sm">{{ name }}</span>
							<UButton
								icon="i-lucide-trash-2"
								size="sm"
								color="neutral"
								variant="ghost"
								:aria-label="`Delete preset ${name}`"
								@click="askDeletePreset(name)"
							/>
						</template>
					</li>
				</ul>
			</template>
		</UModal>

		<UModal
			:open="discardOpen"
			title="Discard unsaved changes?"
			description="The changes you made to this record haven’t been saved."
			@update:open="(value) => value || answerDiscard(false)"
		>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton label="Keep editing" color="neutral" variant="outline" @click="answerDiscard(false)" />
					<UButton label="Discard changes" color="error" @click="answerDiscard(true)" />
				</div>
			</template>
		</UModal>
	</form>
</template>

<script setup>
const props = defineProps({
	// Lets submit buttons outside the form, such as a panel footer, submit it.
	formId: { type: String, required: true },
	// The Cloudflare record being edited. Leave empty to create a record.
	record: { type: Object, default: null },
	defaultType: { type: String, default: 'A' },
	zoneName: { type: String, default: '' },
	disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['submit'])
const dirty = defineModel('dirty', { type: Boolean, default: false })

const notify = useNotify()
const { formatTtl } = useRecordTypes()
const srv = useSrvRecord()
const presetStore = useDnsPresets()
const { presets } = presetStore

const CUSTOM_SERVICE = 'custom'
const TTL_PRESETS = [1, 60, 120, 300, 600, 900, 1800, 3600, 7200, 18000, 43200, 86400]
const NUMBER_ERROR = 'Enter a whole number from 0 to 65535.'

const encoder = new TextEncoder()

const isRecordName = (value) => value === '@' || value === '*' || isHostname(value.replace(/^\*\./, ''))

const isWholeNumber = (value, max) => {
	if (value === '' || value === null || value === undefined) return false
	const number = Number(value)
	return Number.isInteger(number) && number >= 0 && number <= max
}

const TYPES = {
	A: {
		help: 'Points the name at an IPv4 address.',
		proxiable: true,
		content: {
			label: 'IPv4 address',
			placeholder: '192.0.2.1',
			check: (value) => (isIpv4(value) ? '' : 'Enter an IPv4 address, such as 192.0.2.1.')
		}
	},
	AAAA: {
		help: 'Points the name at an IPv6 address.',
		proxiable: true,
		content: {
			label: 'IPv6 address',
			placeholder: '2001:db8::1',
			check: (value) => (isIpv6(value) ? '' : 'Enter an IPv6 address, such as 2001:db8::1.')
		}
	},
	CNAME: {
		help: 'Makes the name an alias of another hostname.',
		proxiable: true,
		content: {
			label: 'Target',
			placeholder: 'origin.example.net',
			check: (value) =>
				value === '@' || isHostname(value) ? '' : 'Enter a hostname, such as origin.example.net.'
		}
	},
	MX: {
		help: 'Sends email for the name to a mail server. Lower priorities are tried first.',
		content: {
			label: 'Mail server',
			placeholder: 'mail.example.com',
			check: (value) =>
				value === '.' || isHostname(value) ? '' : 'Enter a mail server hostname, such as mail.example.com.'
		}
	},
	NS: {
		help: 'Delegates the name to other name servers.',
		content: {
			label: 'Name server',
			placeholder: 'ns1.example.net',
			check: (value) => (isHostname(value) ? '' : 'Enter a name server hostname, such as ns1.example.net.')
		}
	},
	TXT: {
		help: 'Holds text, such as an SPF policy or a domain verification code.',
		content: {
			label: 'Content',
			placeholder: 'v=spf1 include:_spf.example.com ~all',
			check: (value) => (value.trim() ? '' : 'Enter the text value.')
		}
	},
	SRV: { help: 'Tells clients which host and port provide a service.' },
	CAA: { help: 'Limits which certificate authorities may issue certificates for the name.' }
}

const CAA_TAGS = [
	{ label: 'issue', value: 'issue', description: 'Authorities allowed to issue certificates' },
	{ label: 'issuewild', value: 'issuewild', description: 'Authorities allowed to issue wildcard certificates' },
	{ label: 'iodef', value: 'iodef', description: 'Where authorities report requests that break these rules' }
]

const clone = (value) => JSON.parse(JSON.stringify(value))
const pick = (value, fallback) => (value === undefined || value === null ? fallback : value)
const toInteger = (value) => (value === '' || value === null || value === undefined ? '' : Number(value))

const blankState = (type) => ({
	type,
	name: '',
	content: '',
	priority: '',
	ttl: 1,
	proxied: false,
	comment: '',
	srv: { service: '', protocol: '_tcp', target: '', port: '', priority: 1, weight: 10 },
	caa: { flags: 0, tag: 'issue', value: '' }
})

const state = ref(blankState(TYPES[props.defaultType] ? props.defaultType : 'A'))
const baseline = ref(clone(state.value))
const customService = ref(false)
const showErrors = ref(false)
const formEl = useTemplateRef('formEl')

const typeDef = computed(() => TYPES[state.value.type] || TYPES.A)
const typeItems = CREATABLE_RECORD_TYPES.filter((type) => TYPES[type])
const isSrv = computed(() => state.value.type === 'SRV')
const isCaa = computed(() => state.value.type === 'CAA')
const proxied = computed(() => Boolean(typeDef.value.proxiable && state.value.proxied))

// Names are typed relative to the zone ("www" or "@") and sent in full.
const nameFor = (values) => {
	if (values.type !== 'SRV') return qualifiedName(values.name, props.zoneName)
	const host = values.name.trim()
	return srv.buildName(values.srv, host === '@' && !props.zoneName ? '' : qualifiedName(host, props.zoneName))
}

// Exactly what is sent to Cloudflare. Proxying only applies to types that support it, and
// is resolved here rather than by changing the switch when the type changes.
const payloadFor = (values) => {
	const def = TYPES[values.type] || {}
	const isProxied = Boolean(def.proxiable && values.proxied)
	const payload = {
		type: values.type,
		name: nameFor(values),
		ttl: isProxied ? 1 : Number(values.ttl) || 1,
		comment: values.comment.trim()
	}

	if (values.type === 'SRV') {
		payload.data = {
			priority: toInteger(values.srv.priority),
			weight: toInteger(values.srv.weight),
			port: toInteger(values.srv.port),
			target: values.srv.target.trim()
		}
	} else if (values.type === 'CAA') {
		payload.data = { flags: toInteger(values.caa.flags), tag: values.caa.tag, value: values.caa.value.trim() }
	} else {
		payload.content = values.type === 'TXT' ? values.content : values.content.trim()
		if (values.type === 'MX') payload.priority = toInteger(values.priority)
		if (def.proxiable) payload.proxied = isProxied
	}

	return payload
}

const recordName = computed(() => nameFor(state.value))
const srvPreview = computed(() =>
	state.value.srv.service.trim() && state.value.srv.protocol && state.value.name.trim() ? recordName.value : ''
)

const nameHelp = computed(() => {
	if (!isSrv.value && state.value.name.trim()) return `Full name: ${recordName.value}`
	return `Use @ for ${props.zoneName || 'the zone apex'}.`
})

const contentHint = computed(() =>
	state.value.type === 'TXT' ? `${formatNumber(state.value.content.length)} characters` : undefined
)
const contentHelp = computed(() =>
	state.value.type === 'TXT' && encoder.encode(state.value.content).length > 255
		? 'Over 255 bytes, so Cloudflare will split it into several strings.'
		: undefined
)

// A TTL outside the presets, such as one from a zone import, keeps its own option.
const ttlItems = computed(() => {
	const values = new Set(TTL_PRESETS)
	const current = Number(state.value.ttl)
	if (Number.isInteger(current) && current > 0) values.add(current)
	return [...values].sort((a, b) => a - b).map((value) => ({ label: formatTtl(value, { style: 'long' }), value }))
})

const serviceItems = [
	...srv.services.map(({ label, value }) => ({ label, value, description: value })),
	{ label: 'Custom service', value: CUSTOM_SERVICE }
]

const serviceChoice = computed({
	get: () => (customService.value ? CUSTOM_SERVICE : srv.findService(state.value.srv)?.value),
	set: (value) => {
		if (value === CUSTOM_SERVICE) {
			customService.value = true
			return
		}
		const preset = srv.services.find((item) => item.value === value)
		if (!preset) return
		const [service, protocol] = preset.value.split('.')
		customService.value = false
		state.value.srv.service = service
		state.value.srv.protocol = protocol
		if (state.value.srv.port === '' || state.value.srv.port === null) state.value.srv.port = preset.port
	}
})

const protocolItems = computed(() => {
	const current = state.value.srv.protocol
	return current && !srv.protocols.includes(current) ? [...srv.protocols, current] : srv.protocols
})

const caaTagItems = computed(() => {
	const current = state.value.caa.tag
	return current && !CAA_TAGS.some((item) => item.value === current)
		? [...CAA_TAGS, { label: current, value: current }]
		: CAA_TAGS
})

const validate = (values) => {
	const errors = {}
	const name = values.name.trim()
	if (!name) {
		errors.name = `Enter a ${values.type === 'SRV' ? 'host' : 'name'}, or @ for the zone apex.`
	} else if (!isRecordName(name)) {
		errors.name = 'Use letters, numbers, hyphens, underscores and dots, such as www or mail.eu.'
	}

	if (values.type === 'SRV') {
		const service = values.srv.service.trim().replace(/^_/, '')
		if (!/^[a-z0-9-]{1,62}$/i.test(service)) {
			errors.service = customService.value ? 'Enter a service name, such as _sip.' : 'Choose a service.'
		}
		if (!values.srv.protocol) errors.protocol = 'Choose a protocol.'
		const target = values.srv.target.trim()
		if (target !== '.' && !isHostname(target)) errors.target = 'Enter a hostname, such as sip.example.com.'
		if (!isWholeNumber(values.srv.priority, 65535)) errors.srvPriority = NUMBER_ERROR
		if (!isWholeNumber(values.srv.weight, 65535)) errors.weight = NUMBER_ERROR
		if (!isWholeNumber(values.srv.port, 65535)) errors.port = NUMBER_ERROR
	} else if (values.type === 'CAA') {
		const value = values.caa.value.trim()
		if (!values.caa.tag) errors.tag = 'Choose a tag.'
		if (values.caa.tag === 'iodef' && !/^(mailto:|https?:\/\/)\S+$/i.test(value)) {
			errors.caaValue = 'Enter a mailto: address or an https:// URL.'
		} else if (!value) {
			errors.caaValue = 'Enter a certificate authority domain, such as letsencrypt.org.'
		}
		if (!isWholeNumber(values.caa.flags, 255)) errors.flags = 'Enter 0 to 255.'
	} else {
		const def = TYPES[values.type] || TYPES.A
		const message = def.content.check(values.type === 'TXT' ? values.content : values.content.trim())
		if (message) errors.content = message
		if (values.type === 'MX' && !isWholeNumber(values.priority, 65535)) errors.priority = NUMBER_ERROR
	}

	return errors
}

const errors = computed(() => (showErrors.value ? validate(state.value) : {}))
const errorFor = (field) => errors.value[field] || undefined

const isDirty = computed(() => JSON.stringify(payloadFor(state.value)) !== JSON.stringify(payloadFor(baseline.value)))
watch(isDirty, (value) => (dirty.value = value), { immediate: true })

const caaFromRecord = (record) => {
	if (record.data?.tag) {
		return { flags: pick(record.data.flags, 0), tag: record.data.tag, value: pick(record.data.value, '') }
	}
	const match = /^(\d+)\s+(\S+)\s+"?(.*?)"?$/.exec(record.content || '')
	return match ? { flags: Number(match[1]), tag: match[2], value: match[3] } : blankState('CAA').caa
}

const stateFromRecord = (record) => {
	const values = {
		...blankState(record.type),
		ttl: pick(record.ttl, 1),
		proxied: record.proxied === true,
		comment: record.comment || ''
	}

	if (record.type === 'SRV') {
		const parts = srv.parseName(record.name)
		const data = record.data || {}
		values.name = relativeName(parts.host, props.zoneName) || '@'
		values.srv = {
			service: parts.service || srv.withUnderscore(data.service),
			protocol: parts.protocol || srv.withUnderscore(data.proto) || '_tcp',
			target: data.target || '',
			port: pick(data.port, ''),
			priority: pick(data.priority, ''),
			weight: pick(data.weight, '')
		}
	} else if (record.type === 'CAA') {
		values.name = relativeName(record.name, props.zoneName)
		values.caa = caaFromRecord(record)
	} else {
		values.name = relativeName(record.name, props.zoneName)
		values.content = record.content || ''
		if (record.type === 'MX') values.priority = pick(record.priority, '')
	}

	return values
}

const hydrate = (record) => {
	const values = stateFromRecord(record)
	state.value = values
	baseline.value = clone(values)
	customService.value = values.type === 'SRV' && Boolean(values.srv.service) && !srv.findService(values.srv)
	showErrors.value = false
}

watch(
	() => props.record,
	(record) => {
		if (record) hydrate(record)
	},
	{ immediate: true }
)

// Details can arrive after the record; re-hydrate so names show relative to the zone.
watch(
	() => props.zoneName,
	() => {
		if (props.record && !dirty.value) hydrate(props.record)
	}
)

const onSubmit = async () => {
	if (props.disabled || (props.record && !dirty.value)) return
	showErrors.value = true
	if (Object.keys(errors.value).length) {
		await nextTick()
		formEl.value?.querySelector('[aria-invalid="true"]')?.focus()
		return
	}

	const payload = payloadFor(state.value)
	// Cloudflare replaces the whole record on save, so keep what this form doesn't edit.
	const original = props.record
	if (original?.tags?.length) payload.tags = original.tags
	if (original?.settings && original.type === payload.type) payload.settings = original.settings
	emit('submit', payload)
}

// Presets

const savePresetOpen = ref(false)
const managePresetsOpen = ref(false)
const presetName = ref('')
const presetError = ref('')
const pendingPresetDelete = ref('')
const presetExists = computed(() => presetStore.has(presetName.value))

watch(presetName, () => (presetError.value = ''))

const presetValues = (values) => {
	const preset = { type: values.type, ttl: values.ttl, comment: values.comment }
	if (values.type === 'SRV') {
		const { service, protocol, target, port, priority, weight } = values.srv
		preset.srv = { service, protocol, target, port, priority, weight }
	} else if (values.type === 'CAA') {
		preset.caa = { ...values.caa }
	} else {
		preset.content = values.content
		if (values.type === 'MX') preset.priority = values.priority
		if (TYPES[values.type]?.proxiable) preset.proxied = values.proxied
	}
	return preset
}

const applyPreset = (name) => {
	const values = presetStore.load(name)
	if (!values) {
		presetStore.refresh()
		notify.error('Couldn’t apply the preset', 'It may have been deleted in another tab.')
		return
	}

	const type = TYPES[values.type] ? values.type : state.value.type
	const next = { ...clone(state.value), type }
	const ttl = Number(values.ttl)
	if (Number.isInteger(ttl) && ttl > 0) next.ttl = ttl
	if (typeof values.comment === 'string') next.comment = values.comment

	if (type === 'SRV') {
		// Older presets kept SRV fields in Cloudflare's data shape.
		const source = values.srv || { ...values.data, protocol: values.data?.proto }
		next.srv = {
			service: source.service ? srv.withUnderscore(source.service) : next.srv.service,
			protocol: source.protocol ? srv.withUnderscore(source.protocol) : next.srv.protocol,
			target: pick(source.target, next.srv.target),
			port: pick(source.port, next.srv.port),
			priority: pick(source.priority, next.srv.priority),
			weight: pick(source.weight, next.srv.weight)
		}
		customService.value = Boolean(next.srv.service) && !srv.findService(next.srv)
	} else if (type === 'CAA') {
		if (values.caa) next.caa = { ...next.caa, ...values.caa }
	} else {
		if (typeof values.content === 'string') next.content = values.content
		if (values.priority !== undefined) next.priority = values.priority
		if (typeof values.proxied === 'boolean') next.proxied = values.proxied
	}

	state.value = next
}

const openSavePreset = () => {
	presetName.value = ''
	presetError.value = ''
	savePresetOpen.value = true
}

const savePreset = () => {
	const name = presetName.value.trim()
	if (!name) {
		presetError.value = 'Enter a name for the preset.'
		return
	}
	if (!presetStore.save(name, presetValues(state.value))) {
		presetError.value = 'This browser blocked saving. Allow site storage and try again.'
		return
	}
	savePresetOpen.value = false
	notify.success('Preset saved', name)
}

const openManagePresets = () => {
	pendingPresetDelete.value = ''
	managePresetsOpen.value = true
}

const askDeletePreset = async (name) => {
	pendingPresetDelete.value = name
	await nextTick()
	document.querySelector('[data-preset-confirm]')?.focus()
}

const deletePreset = (name) => {
	presetStore.remove(name)
	pendingPresetDelete.value = ''
	notify.success('Preset deleted', name)
}

const presetMenu = computed(() => {
	const groups = []
	if (presets.value.length) {
		groups.push([
			{ type: 'label', label: 'Apply a preset' },
			...presets.value.map((name) => ({
				label: name,
				icon: 'i-lucide-bookmark',
				onSelect: () => applyPreset(name)
			}))
		])
	}
	const actions = [{ label: 'Save as preset…', icon: 'i-lucide-bookmark-plus', onSelect: openSavePreset }]
	if (presets.value.length) {
		actions.push({ label: 'Delete presets…', icon: 'i-lucide-trash-2', onSelect: openManagePresets })
	}
	groups.push(actions)
	return groups
})

onMounted(presetStore.refresh)

// Unsaved changes

const discardOpen = ref(false)
let resolveDiscard = null

const answerDiscard = (discard) => {
	discardOpen.value = false
	resolveDiscard?.(discard)
	resolveDiscard = null
}

// Resolves true when there is nothing to lose or the person chooses to discard.
const confirmDiscard = () => {
	if (!dirty.value) return Promise.resolve(true)
	resolveDiscard?.(false)
	discardOpen.value = true
	return new Promise((resolve) => {
		resolveDiscard = resolve
	})
}

onBeforeUnmount(() => answerDiscard(false))

defineExpose({ confirmDiscard })
</script>
