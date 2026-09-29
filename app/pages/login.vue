<template>
	<AuthShell title="Sign in to DNS Manager">
		<form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
			<UFormField label="Username" :error="errors.username || undefined" size="lg">
				<UInput
					ref="usernameInput"
					v-model="username"
					name="username"
					autocomplete="username"
					autocapitalize="off"
					:spellcheck="false"
					autofocus
					size="lg"
					class="w-full"
				/>
			</UFormField>
			<UFormField label="Password" :error="errors.password || undefined" size="lg">
				<UInput
					ref="passwordInput"
					v-model="password"
					type="password"
					name="password"
					autocomplete="current-password"
					size="lg"
					class="w-full"
				/>
			</UFormField>
			<UButton type="submit" size="lg" block :loading="busy" :label="busy ? 'Signing in…' : 'Sign in'" />
			<p role="status" class="sr-only">{{ busy ? 'Signing in' : '' }}</p>
		</form>
		<p class="text-muted mt-6 text-sm">
			New here?
			<ULink :to="signupLink" class="text-primary font-medium underline-offset-2 hover:underline">
				Create an account
			</ULink>
		</p>
	</AuthShell>
</template>

<script setup>
// Signing in with a DNS Manager account. The session is an HttpOnly cookie; Cloudflare tokens
// stay on the server (see the Cloudflare connections page).
definePageMeta({ layout: false })
useSeoMeta({ title: 'Sign in' })

const route = useRoute()
const auth = useAuth()

const username = ref('')
const password = ref('')
const busy = ref(false)
const errors = reactive({ username: '', password: '' })
const usernameInput = useTemplateRef('usernameInput')
const passwordInput = useTemplateRef('passwordInput')

const signupLink = computed(() => ({
	path: '/signup',
	query: route.query.redirect ? { redirect: route.query.redirect } : {}
}))

watch([username, password], () => {
	errors.username = ''
	errors.password = ''
})

const submit = async () => {
	if (busy.value) return
	if (!username.value.trim()) {
		errors.username = 'Enter your username.'
		return usernameInput.value?.inputRef?.focus()
	}
	if (!password.value) {
		errors.password = 'Enter your password.'
		return passwordInput.value?.inputRef?.focus()
	}
	busy.value = true
	try {
		await auth.signIn(username.value.trim(), password.value)
		// Cloudflare data cached for someone else must not carry over.
		clearNuxtState((key) => key.startsWith('cf-'), { reset: true })
		await navigateTo(safeRedirect(route.query.redirect), { replace: true })
	} catch (error) {
		// Cleared first: clearing the field clears any message, so the message goes in after.
		password.value = ''
		await nextTick()
		errors.password = describeError(error, 'Couldn’t sign in. Try again.')
		passwordInput.value?.inputRef?.focus()
	} finally {
		busy.value = false
	}
}
</script>
