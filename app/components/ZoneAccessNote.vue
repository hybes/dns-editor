<template>
	<p v-if="access?.shared" class="text-muted text-sm">
		Shared by <span class="text-default">{{ access.owner }}</span> · {{ summary }}
	</p>
</template>

<script setup>
// On a zone someone shares with this account: who shares it and what the level for this page's
// area lets the person do. Shows nothing on the account's own zones.
const props = defineProps({
	// useZone().access
	access: { type: Object, default: null },
	// The area this page belongs to, from shared/utils/access.js
	area: { type: String, required: true },
	// What the page shows, for the sentence, e.g. 'records'
	subject: { type: String, required: true }
})

const VERBS = {
	none: 'you can’t see',
	view: 'you can view',
	edit: 'you can view and change',
	delete: 'you can view, change and delete'
}

const summary = computed(() => `${VERBS[props.access?.levels?.[props.area]] || VERBS.none} ${props.subject}`)
</script>
