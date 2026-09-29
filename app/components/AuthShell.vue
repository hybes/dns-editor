<template>
	<div class="bg-default flex min-h-dvh flex-col">
		<header class="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
			<p class="text-highlighted flex items-center gap-2 font-semibold">
				<img src="/favicon.svg" alt="" class="size-6" />
				DNS Manager
			</p>
			<UColorModeButton />
		</header>

		<main class="flex flex-1 justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
			<div class="w-full max-w-sm">
				<h1 class="text-highlighted text-2xl font-semibold text-pretty">{{ title }}</h1>
				<p v-if="$slots.description" class="text-muted mt-2 text-pretty">
					<slot name="description" />
				</p>
				<div class="mt-6">
					<slot />
				</div>
			</div>
		</main>
	</div>
</template>

<script setup>
// The frame around the pages you see before signing in: sign in and create an account.
defineProps({
	title: { type: String, required: true }
})
</script>
