<template>
	<UModal
		:open="open"
		:title="title"
		:description="description"
		:dismissible="!busy"
		:close="{ disabled: busy }"
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
			<div class="flex w-full flex-wrap justify-end gap-2">
				<UButton label="Cancel" color="neutral" variant="ghost" :disabled="busy" @click="setOpen(false)" />
				<UButton
					:label="confirmLabel"
					:icon="confirmIcon"
					:color="confirmColor"
					:loading="busy"
					@click="confirm"
				/>
			</div>
		</template>
	</UModal>
</template>

<script setup>
// Confirms a Registrar change that costs money or risks losing a domain. Like
// AccountDeleteModal, `action` is awaited: when it resolves the modal closes, and when it throws
// the modal stays open with the message so the person can retry or cancel. It can't be
// dismissed while the action runs.
const props = defineProps({
	open: { type: Boolean, default: false },
	title: { type: String, required: true },
	// What confirming does, including any charge; extra detail goes in the default slot
	description: { type: String, default: '' },
	confirmLabel: { type: String, required: true },
	confirmIcon: { type: String, default: undefined },
	confirmColor: { type: String, default: 'primary' },
	errorTitle: { type: String, default: 'Cloudflare didn’t make the change' },
	// () => Promise; throw to keep the modal open
	action: { type: Function, required: true }
})

const emit = defineEmits(['update:open'])

const busy = ref(false)
const error = ref('')

watch(
	() => props.open,
	(open) => {
		if (open) error.value = ''
	}
)

const setOpen = (value) => {
	if (busy.value) return
	emit('update:open', value)
}

const confirm = async () => {
	if (busy.value) return
	busy.value = true
	error.value = ''
	try {
		await props.action()
		emit('update:open', false)
	} catch (reason) {
		error.value = describeError(reason, 'That didn’t go through. Try again.')
	} finally {
		busy.value = false
	}
}
</script>
