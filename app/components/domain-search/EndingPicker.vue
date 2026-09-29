<template>
	<div role="group" :aria-labelledby="labelId" class="flex flex-col gap-2">
		<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
			<p :id="labelId" class="text-default text-sm font-medium">
				Endings to check
				<span class="text-muted font-normal tabular-nums"
					>({{ modelValue.length }} selected, up to {{ max }})</span
				>
			</p>
			<div class="flex flex-wrap items-center gap-1" role="group" aria-label="Ending sets">
				<span class="text-dimmed text-xs">Sets:</span>
				<UButton
					v-for="preset in PRESETS"
					:key="preset.id"
					:label="preset.label"
					size="xs"
					color="neutral"
					variant="link"
					class="px-1"
					@click="applyPreset(preset)"
				/>
				<span class="text-dimmed px-0.5 text-xs" aria-hidden="true">·</span>
				<UButton
					label="Select all"
					size="xs"
					color="neutral"
					variant="link"
					class="px-1"
					:disabled="shown.every((tld) => modelValue.includes(tld))"
					@click="selectAll"
				/>
				<UButton
					label="Deselect all"
					size="xs"
					color="neutral"
					variant="link"
					class="px-1"
					:disabled="!modelValue.length"
					@click="update([])"
				/>
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-1.5">
			<UButton
				v-for="tld in shown"
				:key="tld"
				size="xs"
				:variant="modelValue.includes(tld) ? 'soft' : 'outline'"
				:color="modelValue.includes(tld) ? 'primary' : 'neutral'"
				icon="i-lucide-check"
				:aria-pressed="modelValue.includes(tld)"
				class="font-mono"
				:ui="{ leadingIcon: modelValue.includes(tld) ? '' : 'invisible' }"
				@click="toggle(tld)"
			>
				.{{ tld }}
			</UButton>
		</div>

		<UFormField label="More endings" :description="pickerHelp" :error="error || undefined" class="max-w-md">
			<USelectMenu
				:model-value="modelValue"
				:items="pickerItems"
				value-key="value"
				multiple
				:loading="endingsLoading"
				:virtualize="pickerItems.length > 100"
				:search-input="{ placeholder: 'Search endings, such as shop or co.nz' }"
				:filter-fields="['label', 'value']"
				create-item
				placeholder="Find an ending"
				icon="i-lucide-plus"
				size="sm"
				class="w-full"
				:ui="{ itemLabel: 'font-mono', itemDescription: 'tabular-nums' }"
				@update:model-value="pick"
				@create="create"
				@update:open="(open) => open && loadEndings()"
			>
				<template #default>
					<span class="text-dimmed">Find an ending</span>
				</template>
			</USelectMenu>
		</UFormField>
	</div>
</template>

<script setup>
// The endings a Domain Search checks: quick buttons for common ones, a few sets to start
// from, and a searchable list of every ending in the reference price list (with prices), plus
// any ending typed in that isn't on it. v-model is the list of selected endings, without dots.
const props = defineProps({
	modelValue: { type: Array, default: () => [] },
	max: { type: Number, required: true },
	// Endings added earlier that aren't in the defaults, shown as buttons too
	custom: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue', 'update:custom', 'error'])

const DEFAULTS = ['com', 'net', 'org', 'io', 'co', 'dev', 'app', 'ai', 'uk', 'co.uk', 'me', 'xyz']
const PRESETS = [
	{ id: 'popular', label: 'Popular', tlds: ['com', 'net', 'org', 'co', 'io', 'info', 'biz', 'me', 'xyz'] },
	{ id: 'tech', label: 'Tech', tlds: ['dev', 'app', 'io', 'ai', 'sh', 'tech', 'cloud', 'codes', 'software', 'run'] },
	{ id: 'uk-eu', label: 'UK and Europe', tlds: ['uk', 'co.uk', 'org.uk', 'eu', 'de', 'fr', 'ie', 'nl', 'es', 'it'] },
	{
		id: 'brand',
		label: 'Brand and shop',
		tlds: ['studio', 'design', 'agency', 'shop', 'store', 'online', 'site', 'club', 'life', 'world']
	}
]
const TLD_PATTERN = /^(?:[a-z]{2,63}|xn--[a-z0-9-]+)(?:\.[a-z]{2,63})?$/

const labelId = useId()
const error = ref('')
const { call } = useCfApi()

// Every ending in the reference price list, loaded the first time the list is opened.
const endings = useState('domain-search-endings', () => null)
const endingsLoading = ref(false)
const loadEndings = async () => {
	if (endings.value || endingsLoading.value) return
	endingsLoading.value = true
	try {
		const response = await call('domain_endings', {})
		endings.value = response?.result || { endings: [] }
	} catch {
		endings.value = { endings: [] }
	} finally {
		endingsLoading.value = false
	}
}

const priceNote = (ending) => {
	const currency = endings.value?.currency
	const first = formatMoney(ending.registration, currency)
	if (!first) return ''
	return ending.renewal !== null && ending.renewal !== ending.registration
		? `${first} first year, then ${formatMoney(ending.renewal, currency)}`
		: `${first} a year`
}

const pickerItems = computed(() => {
	const listed = (endings.value?.endings || []).map((ending) => ({
		label: `.${ending.tld}`,
		value: ending.tld,
		description: priceNote(ending)
	}))
	const known = new Set(listed.map((item) => item.value))
	// Selected endings the list doesn't have still need an entry to show as chosen.
	const extra = [...new Set([...props.modelValue, ...props.custom])]
		.filter((tld) => !known.has(tld))
		.map((tld) => ({ label: `.${tld}`, value: tld }))
	return [...extra, ...listed]
})

const pickerHelp = computed(() =>
	endings.value?.source
		? `Prices are ${endings.value.source}’s, for reference. Type any other ending to add it.`
		: 'Search for an ending, or type one to add it.'
)

const shown = computed(() => [...new Set([...DEFAULTS, ...props.custom, ...props.modelValue])])

const setError = (message) => {
	error.value = message
	emit('error', message)
}

// `remember` keeps endings chosen from the list or typed in as buttons, one click away later.
// A set's endings show as buttons only while they're selected.
const update = (list, { remember = false } = {}) => {
	error.value = ''
	const clean = [...new Set(list)]
	const added = remember ? clean.filter((tld) => !DEFAULTS.includes(tld) && !props.custom.includes(tld)) : []
	if (added.length) emit('update:custom', [...props.custom, ...added])
	emit('update:modelValue', clean)
}

const toggle = (tld) => {
	if (props.modelValue.includes(tld)) return update(props.modelValue.filter((item) => item !== tld))
	if (props.modelValue.length >= props.max) {
		return setError(`You can check up to ${props.max} endings at once. Deselect one first.`)
	}
	update([...props.modelValue, tld])
}

const pick = (list) => {
	if (list.length > props.max) {
		return setError(`You can check up to ${props.max} endings at once. Deselect one first.`)
	}
	update(list, { remember: true })
}

const create = (text) => {
	const tld = String(text || '')
		.trim()
		.toLowerCase()
		.replace(/^\.+/, '')
	if (!TLD_PATTERN.test(tld)) return setError(`“.${tld}” isn’t a domain ending.`)
	if (props.modelValue.includes(tld)) return
	pick([...props.modelValue, tld])
}

const applyPreset = (preset) => update(preset.tlds.slice(0, props.max))

// Every ending shown as a button, up to the limit, keeping the ones already chosen.
const selectAll = () => {
	const all = [...new Set([...props.modelValue, ...shown.value])]
	if (all.length > props.max) {
		setError(
			`That’s ${all.length} endings and the most at once is ${props.max}, so the first ${props.max} are selected.`
		)
	}
	emit('update:modelValue', all.slice(0, props.max))
}
</script>
