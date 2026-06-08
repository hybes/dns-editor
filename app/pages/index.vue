<template>
	<Loader fullscreen title="Loading…" subtitle="Taking you to your zones…" />
</template>

<script setup>
// Entry point: the global auth middleware redirects to /login when there is no API
// key; otherwise send the user straight to the zones list.
onMounted(() => {
	navigateTo('/zones', { replace: true })
})
</script>
