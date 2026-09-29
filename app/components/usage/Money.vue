<template>
	<span v-if="text" class="tabular-nums">{{ text }}</span>
	<span v-else class="text-dimmed">{{ missing }}</span>
</template>

<script setup>
// An amount in Cloudflare's currency. Usage lines can cost fractions of a cent, so `precise`
// shows up to four decimal places instead of rounding them away to zero.
const props = defineProps({
	amount: { type: [Number, String], default: null },
	// ISO 4217 code as Cloudflare returns it, e.g. 'USD'
	currency: { type: String, default: '' },
	precise: { type: Boolean, default: false },
	missing: { type: String, default: 'Not given' }
})

const text = computed(() => formatMoney(props.amount, props.currency, { precise: props.precise }))
</script>
