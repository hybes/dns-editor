<template>
	<div
		role="status"
		aria-live="polite"
		aria-busy="true"
		:class="
			fullscreen
				? 'bg-muted/80 fixed inset-0 z-50 flex min-h-dvh w-screen items-center justify-center px-6 backdrop-blur-sm'
				: 'flex items-center justify-center px-6'
		"
	>
		<div
			class="border-default bg-elevated/70 flex w-full max-w-xl flex-col items-center gap-4 rounded-xl border p-6 text-center shadow-sm"
		>
			<svg
				class="text-primary h-12 w-12 animate-spin motion-reduce:animate-none"
				aria-hidden="true"
				xmlns="http://www.w3.org/2000/svg"
				width="32"
				height="32"
				viewBox="0 0 24 24"
			>
				<path
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 3a9 9 0 1 0 9 9"
				/>
			</svg>
			<div class="flex w-full flex-col gap-1">
				<div class="text-highlighted text-lg font-semibold">{{ title }}</div>
				<div v-if="subtitle" class="text-muted text-sm">{{ subtitle }}</div>
			</div>
			<p v-if="hints?.length" class="text-muted w-full text-sm">
				{{ hints.join(' ') }}
			</p>
		</div>
	</div>
</template>

<script setup>
defineProps({
	title: { type: String, default: 'Loading…' },
	subtitle: { type: String, default: '' },
	hints: { type: Array, default: () => [] },
	fullscreen: { type: Boolean, default: false }
})
</script>
