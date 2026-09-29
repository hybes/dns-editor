<template>
	<div class="flex flex-col gap-2">
		<USwitch
			:model-value="enabled"
			label="Also check variations"
			description="Common prefixes and suffixes, such as getname or namehq, checked across the same endings."
			@update:model-value="(value) => emit('update:enabled', value)"
		/>
		<div v-if="enabled" role="group" :aria-labelledby="labelId" class="flex flex-col gap-1.5 ps-11">
			<p :id="labelId" class="sr-only">Variations to check</p>
			<div class="flex flex-wrap items-center gap-1.5">
				<UButton
					v-for="variation in variations"
					:key="variation.id"
					size="xs"
					:variant="selected.includes(variation.id) ? 'soft' : 'outline'"
					:color="selected.includes(variation.id) ? 'primary' : 'neutral'"
					icon="i-lucide-check"
					:aria-pressed="selected.includes(variation.id)"
					class="font-mono"
					:ui="{ leadingIcon: selected.includes(variation.id) ? '' : 'invisible' }"
					@click="toggle(variation.id)"
				>
					{{ variation.label }}
				</UButton>
			</div>
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
				<UButton
					label="Select all"
					size="xs"
					color="neutral"
					variant="link"
					class="px-0"
					:disabled="selected.length === variations.length"
					@click="
						emit(
							'update:selected',
							variations.map((variation) => variation.id)
						)
					"
				/>
				<UButton
					label="Deselect all"
					size="xs"
					color="neutral"
					variant="link"
					class="px-0"
					:disabled="!selected.length"
					@click="emit('update:selected', [])"
				/>
				<p v-if="example" class="text-dimmed text-xs">For example: {{ example }}</p>
			</div>
		</div>
	</div>
</template>

<script setup>
// Prefix and suffix variations of the names being searched, as buttons. The page turns the
// chosen ones into extra names with variationsOf (app/utils/domainVariations.js).
const props = defineProps({
	enabled: { type: Boolean, default: false },
	selected: { type: Array, default: () => [] },
	// The first name being searched, for the example line
	name: { type: String, default: '' }
})

const emit = defineEmits(['update:enabled', 'update:selected'])

const labelId = useId()
const variations = NAME_VARIATIONS

const toggle = (id) =>
	emit(
		'update:selected',
		props.selected.includes(id) ? props.selected.filter((item) => item !== id) : [...props.selected, id]
	)

const example = computed(() => {
	const base = props.name || 'name'
	return variationsOf([base], props.selected).slice(0, 4).join(', ')
})
</script>
