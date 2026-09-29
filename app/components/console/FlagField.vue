<template>
	<UFormField
		:name="fieldName"
		:required="input.required"
		:error="error || false"
		:ui="{ label: 'font-mono text-sm', hint: 'text-dimmed text-xs', description: 'text-muted text-xs' }"
	>
		<template #label>{{ label }}</template>
		<template #hint>{{ hint }}</template>
		<template v-if="input.description" #description>
			<ConsoleHelpText :text="input.description" :clamp="2" />
		</template>

		<USelectMenu
			v-if="choices"
			:model-value="modelValue"
			:items="choices"
			value-key="value"
			:multiple="input.array"
			:search-input="choices.length > 8 ? { placeholder: 'Filter…' } : false"
			:placeholder="placeholder"
			:clear="!input.required"
			class="w-full"
			:ui="{ base: 'font-mono' }"
			@update:model-value="update"
		/>
		<UTextarea
			v-else-if="input.format"
			:model-value="modelValue ?? ''"
			:rows="3"
			autoresize
			:maxrows="16"
			:placeholder="input.format === 'objects' ? '[{ … }]' : '{ … }'"
			spellcheck="false"
			autocapitalize="off"
			autocomplete="off"
			class="w-full"
			:ui="{ base: 'font-mono text-xs' }"
			@update:model-value="update"
		/>
		<UInputTags
			v-else-if="input.array"
			:model-value="Array.isArray(modelValue) ? modelValue : []"
			add-on-paste
			add-on-blur
			:placeholder="input.type === 'number' ? 'Add a number' : 'Add a value'"
			class="w-full"
			:ui="{ itemText: 'font-mono' }"
			@update:model-value="update"
		/>
		<UInput
			v-else
			:model-value="modelValue ?? ''"
			:type="input.type === 'number' ? 'number' : 'text'"
			:inputmode="input.type === 'number' ? 'decimal' : undefined"
			:placeholder="placeholder"
			autocomplete="off"
			autocapitalize="off"
			:spellcheck="false"
			class="w-full"
			:ui="{ base: 'font-mono' }"
			@update:model-value="update"
		/>
	</UFormField>
</template>

<script setup>
// One cf argument or flag as a form field, with the control its type calls for. Values are
// kept as typed; the server converts and checks them the way cf's parser does.
const props = defineProps({
	// An entry from the command's `args` or `flags`
	input: { type: Object, required: true },
	positional: { type: Boolean, default: false },
	modelValue: { type: [String, Number, Boolean, Array], default: undefined },
	error: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

const PLACES = { path: 'Path', query: 'Query', body: 'Body', header: 'Header', form: 'Form' }

const label = computed(() => (props.positional ? `<${props.input.name}>` : `--${props.input.name}`))
const fieldName = computed(() => `cf-${props.positional ? 'arg' : 'flag'}-${props.input.name}`)

const choices = computed(() => {
	if (props.input.type === 'boolean' && !props.input.format) {
		return [
			{ label: 'true', value: true },
			{ label: 'false', value: false }
		]
	}
	if (!props.input.enum?.length) return null
	return props.input.enum.map((value) => ({ label: value === '' ? '(empty)' : String(value), value }))
})

// Where the value goes and what kind it is, as `cf schema` reports it.
const hint = computed(() => {
	const { input } = props
	let kind = input.type === 'number' ? 'number' : input.type === 'boolean' ? 'true or false' : 'text'
	if (input.format === 'objects') kind = 'JSON array of objects'
	else if (input.format === 'json') kind = 'JSON'
	else if (input.enum?.length) kind = `one of ${input.enum.length}`
	if (input.array && !input.format) kind = `list of ${kind === 'text' ? 'values' : kind}`
	return [PLACES[input.in], kind].filter(Boolean).join(' · ')
})

const placeholder = computed(() => {
	const { input } = props
	if (input.default !== undefined && input.default !== '') return `Cloudflare default: ${input.default}`
	if (choices.value) return input.required ? 'Choose…' : 'Not set'
	return input.required ? '' : 'Not set'
})

const update = (value) => emit('update:modelValue', value === null ? undefined : value)
</script>
