<template>
	<UModal
		:open="open"
		:title="title"
		:description="description"
		:dismissible="!deleting"
		:close="{ disabled: deleting }"
		@update:open="setOpen"
	>
		<template v-if="error || $slots.default" #body>
			<div class="flex flex-col gap-4">
				<div v-if="$slots.default" class="text-default text-sm"><slot /></div>
				<UAlert
					v-if="error"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					role="alert"
					:title="errorTitle"
					:description="error"
				/>
			</div>
		</template>

		<template #footer>
			<div class="flex w-full justify-end gap-2">
				<UButton label="Cancel" color="neutral" variant="ghost" :disabled="deleting" @click="setOpen(false)" />
				<UButton
					:label="confirmLabel"
					icon="i-lucide-trash-2"
					color="error"
					:loading="deleting"
					@click="confirm"
				/>
			</div>
		</template>
	</UModal>
</template>

<script setup>
// Confirms a destructive action. `action` is awaited: on success the modal closes, so follow-up
// work belongs in `action`; on failure it stays open with Cloudflare's message so the user can
// retry or cancel.
const props = defineProps({
	open: { type: Boolean, default: false },
	// Name the target, e.g. "Delete the widget ‘Login form’?"
	title: { type: String, required: true },
	// What deleting changes; extra detail can go in the default slot
	description: { type: String, default: '' },
	confirmLabel: { type: String, default: 'Delete' },
	errorTitle: { type: String, default: 'Cloudflare didn’t delete it' },
	// () => Promise; throw to keep the modal open
	action: { type: Function, required: true }
})

const emit = defineEmits(['update:open'])

const deleting = ref(false)
const error = ref('')

watch(
	() => props.open,
	(open) => {
		if (open) error.value = ''
	}
)

const setOpen = (value) => {
	if (deleting.value) return
	emit('update:open', value)
}

const confirm = async () => {
	if (deleting.value) return
	deleting.value = true
	error.value = ''
	try {
		await props.action()
		emit('update:open', false)
	} catch (reason) {
		error.value = describeError(reason, 'The delete didn’t go through. Try again.')
	} finally {
		deleting.value = false
	}
}
</script>
