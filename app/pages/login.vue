<template>
	<div class="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
		<Head>
			<Title>Login</Title>
		</Head>

		<!-- ambient background -->
		<div class="pointer-events-none absolute inset-0 -z-10">
			<div
				class="bg-primary/20 absolute top-[-12%] left-1/2 h-[460px] w-[760px] -translate-x-1/2 rounded-full blur-[130px]"
			/>
			<div
				class="bg-primary/10 absolute right-[6%] bottom-[-15%] h-[320px] w-[440px] rounded-full blur-[130px]"
			/>
		</div>

		<div class="absolute top-4 right-4">
			<ClientOnly>
				<UButton
					:icon="isDark ? 'i-heroicons-moon-20-solid' : 'i-heroicons-sun-20-solid'"
					color="neutral"
					variant="ghost"
					:aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
					@click="isDark = !isDark"
				/>
				<template #fallback>
					<div class="h-8 w-8" />
				</template>
			</ClientOnly>
		</div>

		<div class="w-full max-w-md">
			<div class="mb-8 flex flex-col items-center text-center">
				<div
					class="bg-primary/10 ring-primary/20 mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ring-1"
				>
					<UIcon name="i-heroicons-cloud" class="text-primary h-7 w-7" />
				</div>
				<h1 class="text-highlighted text-2xl font-semibold tracking-tight">DNS Manager</h1>
				<p class="text-muted mt-1.5 text-sm">A faster way to manage your Cloudflare DNS records</p>
			</div>

			<div class="border-default bg-default/70 rounded-2xl border p-6 shadow-xl backdrop-blur">
				<label for="cf-api-key" class="text-highlighted mb-1.5 block text-sm font-medium">
					Cloudflare API token
				</label>
				<UInput
					id="cf-api-key"
					v-model="apiToken"
					:type="showToken ? 'text' : 'password'"
					autofocus
					size="lg"
					icon="i-heroicons-key"
					placeholder="Paste your API token"
					class="w-full"
					:ui="{ trailing: 'pe-1' }"
					@keydown.enter="saveApiToken"
				>
					<template #trailing>
						<UButton
							:icon="showToken ? 'i-heroicons-eye-slash-20-solid' : 'i-heroicons-eye-20-solid'"
							color="neutral"
							variant="ghost"
							size="xs"
							:aria-label="showToken ? 'Hide token' : 'Show token'"
							@click="showToken = !showToken"
						/>
					</template>
				</UInput>
				<p class="text-muted mt-2 text-xs">Stored only in your browser and sent directly to Cloudflare.</p>

				<UButton
					color="primary"
					size="lg"
					block
					class="mt-4"
					trailing-icon="i-heroicons-arrow-right-20-solid"
					:disabled="!apiToken.trim()"
					@click="saveApiToken"
				>
					Continue
				</UButton>

				<div class="text-dimmed my-5 flex items-center gap-3 text-xs">
					<span class="bg-default h-px flex-1" />
					Don't have a token?
					<span class="bg-default h-px flex-1" />
				</div>

				<div class="border-default bg-elevated/40 rounded-xl border p-4">
					<p class="text-highlighted text-sm font-medium">Quick setup</p>
					<p class="text-muted mt-1 text-xs">
						Create a custom token for all accounts &amp; zones, then grant:
					</p>
					<div class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
						<div
							v-for="perm in permissions"
							:key="perm"
							class="text-toned flex items-center gap-1.5 text-xs"
						>
							<UIcon name="i-heroicons-check-circle-20-solid" class="text-primary h-4 w-4 shrink-0" />
							{{ perm }}
						</div>
					</div>
					<UButton
						to="https://dash.cloudflare.com/profile/api-tokens"
						external
						target="_blank"
						rel="noopener noreferrer"
						variant="soft"
						color="neutral"
						block
						class="mt-4"
						icon="i-heroicons-key"
						trailing-icon="i-heroicons-arrow-top-right-on-square-20-solid"
					>
						Open the Cloudflare token page
					</UButton>
				</div>
			</div>

			<p class="text-dimmed mt-6 text-center text-xs">
				Some features depend on your Cloudflare plan, even with the right permissions.
			</p>
		</div>
	</div>
</template>

<script setup>
const apiToken = ref('')
const showToken = ref(false)
const router = useRouter()
const isDark = useIsDark()

const permissions = [
	'Zone — Read, Edit',
	'DNS — Read, Edit',
	'Rulesets — Read, Edit',
	'Bots — Read, Edit',
	'Turnstile — Read, Edit',
	'Analytics — Read'
]

onMounted(() => {
	apiToken.value = (localStorage.getItem(STORAGE_KEYS.apiKey) || '').trim()
	if (apiToken.value) {
		router.push('/')
	}
})

const saveApiToken = () => {
	const token = (apiToken.value || '').trim()
	if (!token) return
	localStorage.setItem(STORAGE_KEYS.apiKey, token)
	router.push('/')
}
</script>
