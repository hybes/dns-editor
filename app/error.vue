<template>
	<UApp>
		<div class="bg-default text-default flex min-h-dvh flex-col">
			<header class="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
				<p class="text-highlighted flex items-center gap-2 font-semibold">
					<img src="/favicon.svg" alt="" class="size-6" />
					DNS Manager
				</p>
				<UColorModeButton />
			</header>

			<main class="flex flex-1 items-center justify-center px-4 pb-16">
				<div class="w-full max-w-lg">
					<h1 class="text-highlighted text-2xl font-semibold text-pretty sm:text-3xl">{{ title }}</h1>

					<template v-if="notFound">
						<p class="text-muted mt-3 text-pretty">
							Nothing exists at
							<code class="text-default font-mono text-sm wrap-anywhere">{{ path }}</code
							>. The link may be incomplete, or the page may have moved.
						</p>
					</template>
					<template v-else>
						<p class="text-muted mt-3 text-pretty wrap-anywhere">{{ detail }}</p>
						<p class="text-muted mt-2 text-pretty">
							Reload to try again. If it keeps happening, go back to your zones.
						</p>
						<p class="text-dimmed mt-4 text-sm tabular-nums">Error {{ statusCode }}</p>
					</template>

					<div class="mt-8 flex flex-wrap gap-2">
						<UButton label="Go to zones" icon="i-lucide-globe" @click="goToZones" />
						<UButton
							label="Reload"
							icon="i-lucide-refresh-cw"
							color="neutral"
							variant="outline"
							@click="reload"
						/>
					</div>
				</div>
			</main>
		</div>
	</UApp>
</template>

<script setup>
const props = defineProps({
	error: { type: Object, default: () => ({}) }
})

const route = useRoute()

const statusCode = computed(() => Number(props.error?.statusCode || props.error?.status) || 500)
const notFound = computed(() => statusCode.value === 404)
const title = computed(() => (notFound.value ? 'Page not found' : 'Something went wrong'))
const detail = computed(
	() => props.error?.message || props.error?.statusMessage || 'DNS Manager hit an unexpected error.'
)
const path = computed(() => route.fullPath)

// app.vue, which normally sets the title suffix, isn't mounted while this page shows.
useHead({ title, titleTemplate: '%s · DNS Manager' })

const goToZones = () => clearError({ redirect: '/zones' })
const reload = () => window.location.reload()
</script>
