<template>
	<div class="min-h-dvh w-full">
		<a class="skip-link" href="#main-content">Skip to content</a>

		<header class="border-default sticky top-0 z-40 border-b bg-[var(--app-header-bg)] backdrop-blur-xl">
			<div :class="headerClass">
				<NuxtLink
					to="/zones"
					class="focus-visible:ring-primary flex min-w-0 items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:outline-none"
					aria-label="DNS Manager home"
				>
					<span
						class="bg-primary/10 ring-primary/20 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1"
					>
						<UIcon name="i-heroicons-cloud" class="text-primary h-5 w-5" aria-hidden="true" />
					</span>
					<span class="min-w-0">
						<span class="text-highlighted block truncate text-sm font-semibold sm:text-base"
							>DNS Manager</span
						>
						<span class="text-muted hidden text-xs sm:block">Cloudflare control centre</span>
					</span>
				</NuxtLink>

				<div class="flex shrink-0 items-center gap-2">
					<UDropdownMenu v-if="hasApiKey" :items="toolItems" :content="{ align: 'end' }">
						<UButton
							color="neutral"
							variant="ghost"
							size="sm"
							icon="i-heroicons-wrench-screwdriver"
							trailing-icon="i-heroicons-chevron-down-20-solid"
							aria-label="Tools"
						>
							<span class="hidden sm:inline">Tools</span>
						</UButton>
					</UDropdownMenu>
					<ClientOnly v-if="showTheme">
						<UButton
							:icon="isDark ? 'i-heroicons-sun-20-solid' : 'i-heroicons-moon-20-solid'"
							color="neutral"
							variant="ghost"
							size="sm"
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
						variant="soft"
						size="sm"
						icon="i-heroicons-arrow-right-on-rectangle"
						aria-label="Log out"
						@click="logout"
					>
						<span class="hidden sm:inline">Log out</span>
					</UButton>
				</div>
			</div>
		</header>

		<main id="main-content" :class="innerClass" tabindex="-1">
			<slot />
		</main>
	</div>
</template>

<script setup>
const props = defineProps({
	fullWidth: { type: Boolean, default: false },
	showLogout: { type: Boolean, default: true },
	showTheme: { type: Boolean, default: true }
})

const innerClass = computed(() => {
	const base = 'mx-auto w-full px-4 py-6 sm:px-6 md:py-8 lg:px-8'
	return props.fullWidth ? base : `${base} max-w-8xl`
})

const headerClass = computed(() => {
	const base = 'mx-auto flex h-16 w-full items-center justify-between gap-4 px-4 sm:px-6 lg:px-8'
	return props.fullWidth ? base : `${base} max-w-8xl`
})

const { getApiKey, logout } = useSession()
const isDark = useIsDark()
const hasApiKey = ref(false)

const toolItems = [
	{ label: 'DNS Lookup', icon: 'i-heroicons-globe-alt', to: '/tools/dns-lookup' },
	{ label: 'Propagation Check', icon: 'i-heroicons-signal', to: '/tools/propagation' },
	{ label: 'Domain Search', icon: 'i-heroicons-shopping-cart', to: '/tools/domain-search' }
]

onMounted(() => {
	hasApiKey.value = Boolean(getApiKey())
})
</script>
