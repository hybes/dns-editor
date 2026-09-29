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
		:actions="actions"
	>
		<template #description>
			<p>{{ reason ? `Cloudflare said: ${reason}` : 'The access check didn’t finish. Try again.' }}</p>
			<p v-if="reason && hint" class="mt-1">{{ hint }}</p>
			<p v-if="reason" class="mt-1">
				Or
				<ULink to="/connections" class="text-highlighted underline"
					>add a connection DNS Manager makes itself</ULink
				>, with every permission it uses.
			</p>
		</template>
	</UAlert>

	<slot v-else />
</template>

<script setup>
import { API_TOKENS_URL } from '#shared/utils/cloudflare'

// Shows a feature's page only when the token can use it: a skeleton while access is being
// checked, Cloudflare's reason when it can't, and a retry when the check itself failed.
const props = defineProps({
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

// A missing permission is fixed on the token in Cloudflare, then checked again here.
const actions = computed(() => [
	{
		label: 'Check again',
		icon: 'i-lucide-refresh-cw',
		color: 'neutral',
		variant: 'outline',
		loading: props.checking,
		onClick: () => emit('retry')
	},
	...(props.reason
		? [
				{
					label: 'Edit the token in Cloudflare',
					icon: 'i-lucide-external-link',
					color: 'neutral',
					variant: 'outline',
					to: API_TOKENS_URL,
					target: '_blank'
				}
			]
		: [])
])
</script>
