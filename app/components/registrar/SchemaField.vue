<template>
	<UFormField v-if="field.kind === 'acknowledgement'" :name="`register-${field.key}`" :error="error || false">
		<UCheckbox
			:model-value="modelValue === true"
			:label="field.text"
			:required="required"
			:ui="{ label: 'whitespace-pre-line' }"
			@update:model-value="(value) => emit('update:modelValue', value === true)"
		/>
	</UFormField>

	<UFormField
		v-else
		:label="field.label"
		:name="`register-${field.key}`"
		:required="required"
		:description="field.help"
		:hint="required ? undefined : 'Optional'"
		:error="error || false"
	>
		<USelect
			v-if="field.kind === 'choice'"
			:model-value="modelValue ?? undefined"
			:items="field.choices"
			placeholder="Choose one"
			class="w-full"
			@update:model-value="update"
		/>
		<USwitch v-else-if="field.kind === 'boolean'" :model-value="modelValue === true" @update:model-value="update" />
		<UInputNumber
			v-else-if="field.kind === 'number'"
			:model-value="typeof modelValue === 'number' ? modelValue : null"
			:min="field.min"
			:max="field.max"
			:step="field.integer ? 1 : 0.01"
			class="w-full"
			@update:model-value="update"
		/>
		<UInput
			v-else
			:model-value="typeof modelValue === 'string' ? modelValue : ''"
			:type="field.inputType"
			:autocomplete="field.autocomplete"
			:maxlength="field.maxLength"
			:spellcheck="false"
			class="w-full"
			:ui="field.upper ? { base: 'uppercase' } : undefined"
			@update:model-value="update"
		/>
	</UFormField>
</template>

<script setup>
// One field of an extension's registration schema, as RegistrarRegisterSlideover describes it:
// an acknowledgement checkbox carrying the registry's own wording, a choice, a switch, a number
// or text. The panel owns the value, the required state and the error.
defineProps({
	// { key, kind, label, help, text, choices, inputType, autocomplete, maxLength, min, max, integer, upper }
	field: { type: Object, required: true },
	modelValue: { type: [String, Number, Boolean], default: undefined },
	required: { type: Boolean, default: false },
	error: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

const update = (value) => emit('update:modelValue', value)
</script>
