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
			<div class="w-full max-w-md">
				<h1 class="text-highlighted text-2xl font-semibold text-pretty">
					{{ replacing ? 'Replace your API token' : 'Sign in with a Cloudflare API token' }}
				</h1>
				<p v-if="replacing" class="text-muted mt-2 text-pretty">
					The new token replaces the one saved in this browser once Cloudflare accepts it. Until then, the
					saved token keeps working.
				</p>

				<form class="mt-6 flex flex-col gap-4" novalidate @submit.prevent="submit">
					<UFormField label="Cloudflare API token" :error="fieldError" size="lg">
						<UInput
							ref="tokenInput"
							v-model="token"
							:type="showToken ? 'text' : 'password'"
							name="cloudflare-api-token"
							autocomplete="off"
							autocapitalize="off"
							:spellcheck="false"
							autofocus
							size="lg"
							icon="i-lucide-key-round"
							placeholder="Paste your token"
							class="w-full"
							:ui="{ trailing: 'pe-1' }"
						>
							<template #trailing>
								<UButton
									:icon="showToken ? 'i-lucide-eye-off' : 'i-lucide-eye'"
									:aria-label="showToken ? 'Hide token' : 'Show token'"
									color="neutral"
									variant="link"
									size="sm"
									type="button"
									@click="showToken = !showToken"
								/>
							</template>
						</UInput>
					</UFormField>

					<div class="flex flex-col gap-2 sm:flex-row">
						<UButton
							type="submit"
							size="lg"
							block
							class="sm:flex-1"
							:loading="verifying"
							:label="submitLabel"
						/>
						<UButton
							v-if="replacing"
							to="/zones"
							size="lg"
							color="neutral"
							variant="ghost"
							label="Cancel"
							class="justify-center"
						/>
					</div>
					<p role="status" class="sr-only">{{ verifying ? 'Checking the token with Cloudflare' : '' }}</p>

					<p class="text-muted text-sm text-pretty">
						The token is saved only in this browser. Requests pass through this server to Cloudflare, and
						the server doesn’t store the token.
					</p>
				</form>

				<section aria-labelledby="token-setup-title" class="border-default mt-10 border-t pt-6">
					<h2 id="token-setup-title" class="text-highlighted font-semibold">Don’t have a token?</h2>
					<ol class="text-muted marker:text-dimmed mt-3 flex list-decimal flex-col gap-4 ps-5 text-sm">
						<li class="text-pretty">
							Open
							<ULink
								:to="API_TOKENS_URL"
								target="_blank"
								class="text-primary font-medium underline-offset-2 hover:underline"
							>
								API Tokens in Cloudflare<span class="sr-only"> (opens in a new tab)</span>
								<UIcon name="i-lucide-external-link" class="inline size-3.5 align-[-2px]" />
							</ULink>
							and choose <strong class="text-default font-medium">Create Token</strong>, then
							<strong class="text-default font-medium">Create Custom Token</strong>.
						</li>
						<li>
							<p class="text-pretty">Add the permissions for the features you use:</p>
							<table class="mt-2 w-full">
								<caption class="sr-only">
									Token permissions and the features that need them
								</caption>
								<thead>
									<tr class="text-dimmed border-default border-b text-start">
										<th scope="col" class="pe-3 pb-1.5 text-start font-medium">Permission</th>
										<th scope="col" class="pe-3 pb-1.5 text-start font-medium">Access</th>
										<th scope="col" class="pb-1.5 text-start font-medium">Used for</th>
									</tr>
								</thead>
								<tbody v-for="group in PERMISSION_GROUPS" :key="group.scope">
									<tr>
										<th
											scope="rowgroup"
											colspan="3"
											class="text-highlighted pt-3 pb-1 text-start font-medium"
										>
											{{ group.scope }}
										</th>
									</tr>
									<tr v-for="item in group.items" :key="item.name">
										<th scope="row" class="text-default py-1 pe-3 text-start font-normal">
											{{ item.name }}
										</th>
										<td class="py-1 pe-3">{{ item.access }}</td>
										<td class="py-1">{{ item.use }}</td>
									</tr>
								</tbody>
							</table>
						</li>
						<li class="text-pretty">
							Under <strong class="text-default font-medium">Account Resources</strong> and
							<strong class="text-default font-medium">Zone Resources</strong>, include the accounts and
							zones you manage. Create the token, then paste it above.
						</li>
					</ol>
					<p class="text-muted mt-4 text-sm text-pretty">
						Some features also depend on your Cloudflare plan, even with the right permissions.
					</p>
				</section>
			</div>
		</main>
	</div>
</template>

<script setup>
import { API_TOKENS_URL } from '#shared/utils/cloudflare'

definePageMeta({ layout: false })

// Names match Cloudflare's permission list when creating a custom token.
const PERMISSION_GROUPS = [
	{
		scope: 'Zone',
		items: [
			{ name: 'Zone', access: 'Read', use: 'Listing zones' },
			{ name: 'DNS', access: 'Edit', use: 'Records' },
			{ name: 'Zone Settings', access: 'Edit', use: 'SSL mode' },
			{ name: 'Zone WAF', access: 'Edit', use: 'Rules' },
			{ name: 'Bot Management', access: 'Edit', use: 'Bot Fight Mode' }
		]
	},
	{
		scope: 'Account',
		items: [
			{ name: 'Turnstile', access: 'Edit', use: 'Turnstile' },
			{ name: 'DNS Firewall', access: 'Edit', use: 'DNS Firewall' },
			{ name: 'Account Analytics', access: 'Read', use: 'Analytics' }
		]
	}
]

const route = useRoute()
const { call } = useCfApi()
const toast = useToast()

const storedToken = readStorage(STORAGE_KEYS.apiKey).trim()
const replacing = Boolean(storedToken && route.query.replace)

useSeoMeta({ title: replacing ? 'Replace token' : 'Sign in' })

const token = ref('')
const showToken = ref(false)
const verifying = ref(false)
const fieldError = ref('')
const tokenInput = useTemplateRef('tokenInput')

const submitLabel = computed(() => {
	if (verifying.value) return 'Checking with Cloudflare…'
	return replacing ? 'Check and replace token' : 'Check token and continue'
})

watch(token, () => {
	fieldError.value = ''
})

// Follow only an in-app path from the auth redirect; anything else goes to the zones list.
const destination = computed(() => {
	const target = route.query.redirect
	if (typeof target !== 'string' || !target.startsWith('/') || /^\/[\\/]/.test(target)) return '/zones'
	return target.startsWith('/login') ? '/zones' : target
})

// Focusing the field makes screen readers announce the error it now describes.
const showFieldError = async (message) => {
	fieldError.value = message
	await nextTick()
	tokenInput.value?.inputRef?.focus()
}

const submit = async () => {
	if (verifying.value) return
	const value = token.value.trim()
	if (!value) return showFieldError('Paste your Cloudflare API token.')

	verifying.value = true
	try {
		// auth:false sends this token instead of the saved one, and keeps a bad token here
		// from raising the "saved token rejected" toast.
		await call('verify_token', { apiKey: value }, { auth: false, fallback: 'Cloudflare didn’t accept this token.' })
	} catch (error) {
		verifying.value = false
		return showFieldError(describeError(error, 'Couldn’t check the token. Try again.'))
	}

	// Zone details and feature checks cached for a different token must not carry over.
	// Resetting rather than deleting keeps any still-mounted reader from seeing undefined.
	if (value !== storedToken) clearNuxtState((key) => key.startsWith('cf-'), { reset: true })
	localStorage.setItem(STORAGE_KEYS.apiKey, value)
	// The new token is accepted, so a "saved token rejected" warning no longer applies.
	toast.remove('cf-token-rejected')

	try {
		await navigateTo(destination.value, { replace: true })
	} finally {
		verifying.value = false
	}
}
</script>
