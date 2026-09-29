<template>
	<UAlert color="warning" variant="subtle" icon="i-lucide-lock" :title="title" :actions="actions">
		<template #description>
			<div class="flex flex-col gap-2">
				<template v-if="permissions.length">
					<p>
						Add {{ permissions.length === 1 ? 'this permission' : 'these permissions' }} to the token in
						Cloudflare:
					</p>
					<ul class="flex flex-col gap-1">
						<li v-for="item in permissions" :key="item.key">
							<span class="text-highlighted font-medium"
								>Account · {{ item.name }} · {{ item.access }}</span
							>
							for {{ item.use }}
						</li>
					</ul>
					<p>
						On Cloudflare’s API tokens page, choose Edit in the token’s menu, add
						{{ permissions.length === 1 ? 'it' : 'them' }} and save, then check again here. The token itself
						doesn’t change, so you don’t need to sign in again.
					</p>
					<p>
						Or
						<ULink to="/connections" class="text-highlighted underline"
							>add a connection DNS Manager makes itself</ULink
						>, with every permission it uses.
					</p>
				</template>
				<p v-if="r2Off">
					R2 isn’t turned on for this account yet. Turn it on in the Cloudflare dashboard to see R2 storage
					here and keep files for each domain.
				</p>
			</div>
		</template>
	</UAlert>
</template>

<script setup>
import { API_TOKENS_URL } from '#shared/utils/cloudflare'

// One explanation, at the top of the usage page, of what the token can't read there and how to
// fix it, in place of an error in each section. Sections the token can't read hide themselves.
const props = defineProps({
	// What's missing: 'billing', 'r2', 'analytics' and 'r2-off' (R2 not turned on)
	missing: { type: Array, required: true },
	account: { type: String, required: true },
	// Whether every section is hidden, for the title
	everything: { type: Boolean, default: false },
	checking: { type: Boolean, default: false }
})

const emit = defineEmits(['check'])

// Named as Cloudflare's token form shows them: scope, permission, access.
const PERMISSIONS = [
	{ key: 'billing', name: 'Billing', access: 'Read', use: 'billable usage, subscriptions and billing history' },
	{ key: 'r2', name: 'Workers R2 Storage', access: 'Edit', use: 'the R2 bucket list and each domain’s Files page' },
	{ key: 'analytics', name: 'Account Analytics', access: 'Read', use: 'R2 storage and operations' }
]

const permissions = computed(() => PERMISSIONS.filter((item) => props.missing.includes(item.key)))
const r2Off = computed(() => props.missing.includes('r2-off'))

const title = computed(() =>
	props.everything ? 'This token can’t read this account’s usage and billing' : 'This token can’t see everything here'
)

// As on AccountFeatureGate and every other alert: neutral outline buttons, Check again first.
const actions = computed(() => [
	{
		label: 'Check again',
		icon: 'i-lucide-refresh-cw',
		color: 'neutral',
		variant: 'outline',
		loading: props.checking,
		onClick: () => emit('check')
	},
	...(permissions.value.length
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
		: []),
	...(r2Off.value
		? [
				{
					label: 'Turn on R2 in Cloudflare',
					icon: 'i-lucide-external-link',
					color: 'neutral',
					variant: 'outline',
					to: `https://dash.cloudflare.com/${encodeURIComponent(props.account)}/r2/overview`,
					target: '_blank'
				}
			]
		: [])
])
</script>
