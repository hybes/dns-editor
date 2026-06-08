<template>
	<div class="bg-default text-default relative flex h-screen w-screen flex-col items-center justify-center">
		<div class="absolute top-4 right-4">
			<ClientOnly>
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
		</div>
		<h1 class="mb-4 text-6xl font-bold">{{ statusCode }}</h1>
		<p class="text-muted mb-8 text-xl">{{ message }}</p>
		<UButton variant="outline" color="primary" @click="goHome">Go to Home</UButton>
	</div>
</template>

<script setup>
const props = defineProps({
	error: { type: Object, default: () => ({}) }
})

const isDark = useIsDark()

const statusCode = computed(() => props.error?.statusCode || 404)
const message = computed(() => {
	if (statusCode.value === 404) return 'Page not found'
	return props.error?.statusMessage || props.error?.message || 'Something went wrong'
})

const goHome = () => clearError({ redirect: '/' })
</script>
