<template>
	<p class="flex items-start gap-1.5">
		<UIcon :name="verdict.icon" class="mt-0.5 size-3.5 shrink-0" :class="verdict.iconClass" aria-hidden="true" />
		<span class="min-w-0">
			<span v-if="label" class="text-default font-medium">{{ label }}</span>
			{{ verdict.text }}
			<ULink
				v-if="verdict.dashboard && account"
				:to="dashboardUrl"
				target="_blank"
				class="text-primary underline-offset-2 hover:underline"
			>
				Register it in the dashboard<span class="sr-only"> (opens in a new tab)</span>
			</ULink>
		</span>
	</p>
</template>

<script setup>
// Cloudflare Registrar's answer for one name from `registrar registrations check`, as a plain
// sentence: whether this app can register it, or Cloudflare's documented reason why not.
// Prices are left to the page, which knows how it wants to show them.
const props = defineProps({
	// One entry of the check result's `domains`
	result: { type: Object, default: null },
	// Account ID, for the dashboard link on endings the API can't register yet
	account: { type: String, default: '' },
	// Shown in bold before the sentence, such as "Cloudflare Registrar:"
	label: { type: String, default: '' }
})

const REASONS = {
	extension_not_supported_via_api: {
		text: 'Cloudflare Registrar sells this ending, but not through its API yet.',
		dashboard: true
	},
	extension_not_supported: { text: 'Cloudflare Registrar doesn’t sell this ending.' },
	extension_disallows_registration: {
		text: 'The registry for this ending isn’t accepting new registrations at the moment.'
	},
	domain_premium: { text: 'This is a premium name. Cloudflare’s API can only register standard-priced names.' },
	domain_unavailable: { text: 'Already registered, reserved or otherwise unavailable.' }
}

const AVAILABLE = { icon: 'i-lucide-circle-check', iconClass: 'text-success' }
const UNAVAILABLE = { icon: 'i-lucide-circle-minus', iconClass: 'text-muted' }
const PROBLEM = { icon: 'i-lucide-circle-alert', iconClass: 'text-warning' }

const verdict = computed(() => {
	const result = props.result
	if (!result) return { ...PROBLEM, text: 'Cloudflare didn’t return a result for this name.' }
	if (result.registrable === true) {
		// Registrable results should always be standard and priced; cf refuses anything else.
		if (result.tier !== 'standard') {
			return {
				...PROBLEM,
				text: 'This is a premium name. Cloudflare’s API can only register standard-priced names.'
			}
		}
		if (!result.pricing?.currency || !result.pricing?.registration_cost) {
			return { ...PROBLEM, text: 'Cloudflare didn’t return a price for it, so it can’t be registered here.' }
		}
		return { ...AVAILABLE, text: 'Available to register with Cloudflare.' }
	}
	const known = REASONS[result.reason]
	if (known) return { ...(result.reason === 'domain_unavailable' ? UNAVAILABLE : PROBLEM), ...known }
	return {
		...PROBLEM,
		text: result.reason ? `Cloudflare can’t register it (${result.reason}).` : 'Cloudflare can’t register it.'
	}
})

const dashboardUrl = computed(
	() => `https://dash.cloudflare.com/${encodeURIComponent(props.account)}/domains/registrations`
)
</script>
