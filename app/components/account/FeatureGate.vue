<template>
	<div v-if="!loaded" class="flex flex-col gap-3" aria-busy="true">
		<p class="sr-only" role="status">Checking whether this token can use {{ feature }}…</p>
		<USkeleton class="h-8 w-full max-w-sm" />
		<USkeleton v-for="row in 5" :key="row" class="h-11 w-full" />
	</div>

	<UAlert
		v-else-if="!available"
		:color="reason ? 'warning' : 'error'"
		variant="subtle"
		:icon="reason ? 'i-lucide-lock' : 'i-lucide-circle-alert'"
		:title="reason ? `This token can’t use ${feature}` : `Couldn’t check access to ${feature}`"
		:actions="[
			{
				label: 'Check again',
				icon: 'i-lucide-refresh-cw',
				color: 'neutral',
				variant: 'outline',
				loading: checking,
				onClick: () => emit('retry')
			}
		]"
	>
		<template #description>
			<p>{{ reason ? `Cloudflare said: ${reason}` : 'The access check didn’t finish. Try again.' }}</p>
			<p v-if="reason && hint" class="mt-1">{{ hint }}</p>
		</template>
	</UAlert>

	<slot v-else />
</template>

<script setup>
// Shows a feature's page only when the token can use it: a skeleton while access is being
// checked, Cloudflare's reason when it can't, and a retry when the check itself failed.
defineProps({
	// useZone().capabilitiesLoaded
	loaded: { type: Boolean, default: false },
	// useZone().can(featureKey)
	available: { type: Boolean, default: false },
	// Feature name for the messages, e.g. 'Turnstile'
	feature: { type: String, required: true },
	// The reason from useZone().missingCapabilities; empty when the check failed
	reason: { type: String, default: '' },
	// What to change on the token, shown under Cloudflare's reason
	hint: { type: String, default: '' },
	// useZone().loading, so the retry button shows progress
	checking: { type: Boolean, default: false }
})

const emit = defineEmits(['retry'])
</script>
