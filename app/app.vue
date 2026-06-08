<template>
	<UApp>
		<div class="relative min-h-screen">
			<div v-if="appBootLoading">
				<Loader
					fullscreen
					title="Preparing Cloudflare DNS Editor"
					subtitle="Checking your API key and restoring your session…"
					:hints="[
						'If this takes longer than a few seconds, check your API key is still valid.',
						'Ensure your token has permission to read zones and manage DNS.'
					]"
				/>
			</div>

			<NuxtPage />
		</div>
	</UApp>
</template>

<script setup>
// The global auth middleware (~/middleware/auth.global.js) owns the redirect to
// /login when no API key is present, so app boot only needs to release the splash.
const appBootLoading = useState('appBootLoading', () => true)

onMounted(() => {
	appBootLoading.value = false
})
</script>

<style>
.fade-enter-active,
.fade-leave-active {
	opacity: 1;
	transition: opacity 0.2s cubic-bezier(0.33, 1, 0.68, 1);
}

.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}
</style>
