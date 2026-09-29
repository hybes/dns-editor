<template>
	<section :aria-labelledby="headingId" :aria-busy="loading" class="flex min-w-0 flex-col gap-3">
		<div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
			<div class="flex min-w-0 flex-col gap-1">
				<h2 :id="headingId" class="text-highlighted text-base font-semibold">{{ title }}</h2>
				<div v-if="$slots.description" class="text-muted max-w-3xl text-sm text-pretty">
					<slot name="description" />
				</div>
			</div>
			<slot name="actions" />
		</div>

		<UAlert
			v-if="error"
			color="error"
			variant="subtle"
			icon="i-lucide-circle-alert"
			role="alert"
			:title="errorTitle"
			:actions="[
				{
					label: 'Try again',
					icon: 'i-lucide-refresh-cw',
					color: 'neutral',
					variant: 'outline',
					loading,
					onClick: () => emit('retry')
				}
			]"
		>
			<template #description>
				<p>Cloudflare said: {{ error }}</p>
			</template>
		</UAlert>

		<slot />
	</section>
</template>

<script setup>
// One section of the usage page: its heading and description, Cloudflare's error with a Try
// again, then the section's own content. A missing permission is explained once by the page
// (UsageAccessGuide) rather than here. Each section loads by itself, so one that fails leaves the
// others alone.
defineProps({
	title: { type: String, required: true },
	loading: { type: Boolean, default: false },
	// Cloudflare's message; empty when the last load worked
	error: { type: String, default: '' },
	errorTitle: { type: String, default: 'Couldn’t load this section' }
})

const emit = defineEmits(['retry'])
const headingId = useId()
</script>
