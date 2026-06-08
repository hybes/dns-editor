<template>
	<div class="min-h-screen w-full">
		<div :class="innerClass">
			<div class="flex items-center justify-end gap-2 pb-4">
				<ClientOnly v-if="showTheme">
					<UButton
						:icon="isDark ? 'i-heroicons-moon-20-solid' : 'i-heroicons-sun-20-solid'"
						color="neutral"
						variant="outline"
						:aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
						@click="isDark = !isDark"
					/>
					<template #fallback>
						<div class="h-8 w-8" />
					</template>
				</ClientOnly>
				<UButton
					v-if="showLogout && hasApiKey"
					color="error"
					variant="outline"
					icon="i-heroicons-arrow-right-on-rectangle"
					@click="logout"
				>
					Logout
				</UButton>
			</div>
			<slot />
		</div>
	</div>
</template>

<script setup>
const props = defineProps({
	fullWidth: { type: Boolean, default: false },
	showLogout: { type: Boolean, default: true },
	showTheme: { type: Boolean, default: true }
})

const innerClass = computed(() => {
	const base = 'mx-auto w-full px-4 py-6 md:px-8'
	return props.fullWidth ? base : `${base} max-w-8xl`
})

const { getApiKey, logout } = useSession()
const isDark = useIsDark()
const hasApiKey = ref(false)

onMounted(() => {
	hasApiKey.value = Boolean(getApiKey())
})
</script>
