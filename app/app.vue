<template>
	<UApp>
		<NuxtRouteAnnouncer />
		<NuxtLoadingIndicator color="var(--ui-primary)" :height="2" />
		<NuxtLayout>
			<NuxtPage />
		</NuxtLayout>
	</UApp>
</template>

<script setup>
// The global auth middleware (~/middleware/auth.global.js) redirects to /login when no
// token is stored. With client-side rendering it runs before the first page renders.
const colorMode = useColorMode()

useHead(() => ({
	titleTemplate: (title) => (title ? `${title} · DNS Manager` : 'DNS Manager'),
	meta: [
		{
			name: 'theme-color',
			content: colorMode.value === 'dark' ? '#10141a' : '#fbfcfd'
		}
	]
}))
</script>
