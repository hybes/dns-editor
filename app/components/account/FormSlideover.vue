<template>
	<USlideover
		:open="open"
		:title="title"
		:description="description"
		:dismissible="dismissible && !saving"
		:close="{ disabled: saving || !dismissible }"
		@update:open="setOpen"
	>
		<template #body>
			<form :id="formId" class="flex flex-col gap-5" novalidate @submit.prevent="onSubmit">
				<UAlert
					v-if="error"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					role="alert"
					:title="errorTitle"
					:description="error"
				/>
				<slot />
			</form>
		</template>

		<template #footer>
			<slot name="footer">
				<div class="flex w-full justify-end gap-2">
					<UButton
						label="Cancel"
						color="neutral"
						variant="ghost"
						:disabled="saving"
						@click="setOpen(false)"
					/>
					<UButton type="submit" :form="formId" :label="submitLabel" :loading="saving" />
				</div>
			</slot>
		</template>
	</USlideover>
</template>

<script setup>
// The create/edit panel shell for account resources: a form in a slide-over with Cancel and
// submit in the footer, Cloudflare's error pinned above the fields, and no dismissing while
// a save is in flight. The page owns the fields (default slot), validation and saving.
// Override #footer for a state without a form, such as showing a one-time secret.
const props = defineProps({
	open: { type: Boolean, default: false },
	title: { type: String, required: true },
	description: { type: String, default: '' },
	submitLabel: { type: String, default: 'Save' },
	saving: { type: Boolean, default: false },
	// Message from the failed request; field errors belong on the fields
	error: { type: String, default: '' },
	errorTitle: { type: String, default: 'Cloudflare didn’t save the changes' },
	dismissible: { type: Boolean, default: true }
})

const emit = defineEmits(['update:open', 'submit'])
const formId = useId()

const setOpen = (value) => {
	if (props.saving) return
	emit('update:open', value)
}

const onSubmit = () => {
	if (!props.saving) emit('submit')
}
</script>
