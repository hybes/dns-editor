<template>
	<UCollapsible v-model:open="expanded" class="flex flex-col gap-2">
		<UButton
			:label="label"
			color="neutral"
			variant="link"
			size="sm"
			trailing-icon="i-lucide-chevron-down"
			class="group self-start px-0"
			:ui="{ trailingIcon: 'transition-transform duration-200 group-data-[state=open]:rotate-180' }"
		/>

		<template #content>
			<div class="flex flex-col gap-3 pt-1">
				<template v-if="editable">
					<UFormField label="JSON" :description="help" :error="parseError || false">
						<UTextarea
							v-model="draft"
							:rows="10"
							autoresize
							:maxrows="24"
							spellcheck="false"
							autocapitalize="off"
							autocomplete="off"
							class="w-full"
							:ui="{ base: 'font-mono text-xs' }"
							@update:model-value="edited = true"
						/>
					</UFormField>
					<div class="flex flex-wrap gap-2">
						<UButton
							:label="applyLabel"
							icon="i-lucide-check"
							size="sm"
							color="neutral"
							variant="outline"
							:disabled="!edited"
							@click="apply"
						/>
						<UButton
							label="Discard JSON edits"
							size="sm"
							color="neutral"
							variant="ghost"
							:disabled="!edited"
							@click="reset"
						/>
						<UButton
							label="Copy JSON"
							icon="i-lucide-copy"
							size="sm"
							color="neutral"
							variant="ghost"
							@click="copy(draft, 'JSON')"
						/>
					</div>
				</template>

				<template v-else>
					<pre class="bg-muted text-default max-h-96 overflow-auto rounded-md p-3 font-mono text-xs">{{
						formatted
					}}</pre>
					<UButton
						label="Copy JSON"
						icon="i-lucide-copy"
						size="sm"
						color="neutral"
						variant="ghost"
						class="self-start"
						@click="copy(formatted, 'JSON')"
					/>
				</template>
			</div>
		</template>
	</UCollapsible>
</template>

<script setup>
// A collapsed "Raw JSON" section for advanced use. Read-only it shows `value`; with `editable`
// it also lets the user edit the text and emits `apply` with the parsed result, leaving the
// page to decide what to do with it (usually copying known fields back into its form).
// `dirty` reports whether there are edits not yet applied or discarded, so the page can stop
// a save that would silently leave them out.
const props = defineProps({
	value: { type: [Object, Array], required: true },
	label: { type: String, default: 'Raw JSON' },
	editable: { type: Boolean, default: false },
	// Shown under the editor, e.g. what applying changes
	help: { type: String, default: '' },
	applyLabel: { type: String, default: 'Apply JSON' }
})

const emit = defineEmits(['apply', 'dirty'])
const { copy } = useNotify()

const expanded = ref(false)
const formatted = computed(() => JSON.stringify(props.value, null, 2))
const draft = ref(formatted.value)
const edited = ref(false)
const parseError = ref('')

// Follow the source while the text is untouched, so changes made in the form show up here.
watch(formatted, (next) => {
	if (!edited.value) draft.value = next
})

watch(edited, (value) => emit('dirty', value))

const reset = () => {
	edited.value = false
	parseError.value = ''
	draft.value = formatted.value
}

const apply = async () => {
	let parsed
	try {
		parsed = JSON.parse(draft.value)
	} catch (error) {
		parseError.value = `This isn’t valid JSON: ${error.message}`
		return
	}
	const expectsObject = !Array.isArray(props.value)
	if (expectsObject && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
		parseError.value = 'Enter a JSON object, starting with {'
		return
	}
	parseError.value = ''
	emit('apply', parsed)
	await nextTick()
	reset()
}
</script>
