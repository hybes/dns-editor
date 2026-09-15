<template>
	<USelectMenu
		:model-value="zoneId || undefined"
		:items="items"
		value-key="value"
		:search-input="{ placeholder: 'Find a zone…' }"
		:virtualize="items.length > 100"
		:loading="loading && !items.length"
		icon="i-lucide-globe"
		placeholder="Choose a zone"
		color="neutral"
		variant="outline"
		class="w-full"
		:content="{ align: 'start' }"
		:ui="{ content: 'min-w-64' }"
		aria-label="Switch zone"
		@update:model-value="switchTo"
	/>
</template>

<script setup>
const props = defineProps({
	zoneId: { type: String, default: '' },
	zoneName: { type: String, default: '' }
})

// Sections every zone has; a deeper page such as one record falls back to its section.
const ZONE_SECTIONS = ['records', 'rules', 'analytics', 'turnstile', 'dns-views', 'dns-firewall']

const route = useRoute()
const { zones, loading } = useZones()

const items = computed(() => {
	const list = zones.value.map((zone) => ({
		label: zone.name,
		value: zone.id,
		description: zone.status === 'active' ? undefined : zone.status
	}))
	// Until the zone's name arrives (or if it never does) show a placeholder, not the raw ID.
	if (props.zoneId && !list.some((item) => item.value === props.zoneId)) {
		list.unshift({ label: props.zoneName || 'Current zone', value: props.zoneId })
	}
	return list
})

const switchTo = (id) => {
	if (!id || id === props.zoneId) return
	if (!route.params.zone_id) return navigateTo(`/zones/${id}/records`)
	const section = route.path.split('/')[3]
	if (!section) return navigateTo(`/zones/${id}`)
	return navigateTo(`/zones/${id}/${ZONE_SECTIONS.includes(section) ? section : 'records'}`)
}
</script>
