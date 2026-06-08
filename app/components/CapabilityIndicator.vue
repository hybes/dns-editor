<template>
	<div v-if="missingItems.length" class="flex items-center">
		<UPopover>
			<UButton size="xs" variant="soft" color="warning" icon="i-heroicons-exclamation-triangle">
				Limited access
			</UButton>
			<template #content>
				<div class="max-w-sm p-3">
					<div class="text-sm font-medium text-stone-900 dark:text-stone-100">Unavailable features</div>
					<div class="mt-2 space-y-2">
						<div v-for="item in missingItems" :key="item.key" class="flex flex-col">
							<div class="text-sm font-medium text-stone-800 dark:text-stone-100">
								{{ labelFor(item.key) }}
							</div>
							<div class="text-xs text-stone-600 dark:text-stone-400">{{ item.reason }}</div>
						</div>
					</div>
				</div>
			</template>
		</UPopover>
	</div>
</template>

<script setup>
defineProps({
	missingItems: {
		type: Array,
		default: () => []
	}
})

const labelFor = (key) => {
	const map = {
		zones: 'Zones',
		zone: 'Zone details',
		dns: 'DNS',
		ssl: 'SSL',
		rulesets: 'Rulesets',
		botFightMode: 'Bot Fight Mode',
		turnstile: 'Turnstile',
		dnsViews: 'DNS Views',
		dnsFirewall: 'DNS Firewall',
		accountAnalytics: 'Account Analytics'
	}
	return map[key] || key
}
</script>
