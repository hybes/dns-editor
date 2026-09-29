<template>
	<AuthShell title="Create a DNS Manager account">
		<template #description>
			Your account keeps your Cloudflare connections on this server, encrypted, so you can manage every account
			and domain from one sign-in.
		</template>
		<form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
			<UFormField
				label="Username"
				help="3 to 32 letters, numbers, dots, hyphens or underscores."
				:error="errors.username || undefined"
				size="lg"
			>
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
			<UFormField label="Password" help="At least 10 characters." :error="errors.password || undefined" size="lg">
				<UInput
					ref="passwordInput"
					v-model="password"
					type="password"
					name="new-password"
					autocomplete="new-password"
					size="lg"
					class="w-full"
				/>
			</UFormField>
			<UFormField label="Password again" :error="errors.confirm || undefined" size="lg">
				<UInput
					ref="confirmInput"
					v-model="confirm"
					type="password"
					name="confirm-password"
					autocomplete="new-password"
					size="lg"
					class="w-full"
				/>
			</UFormField>
			<UButton
				type="submit"
				size="lg"
				block
				:loading="busy"
				:label="busy ? 'Creating your account…' : 'Create account'"
			/>
			<p role="status" class="sr-only">{{ busy ? 'Creating your account' : '' }}</p>
		</form>
		<p class="text-muted mt-6 text-sm">
			Already have an account?
			<ULink :to="loginLink" class="text-primary font-medium underline-offset-2 hover:underline">Sign in</ULink>
		</p>
	</AuthShell>
</template>

<script setup>
// Creating a DNS Manager account. Anyone who can reach this install can sign up; each account
// only sees the Cloudflare connections it adds.
definePageMeta({ layout: false })
useSeoMeta({ title: 'Create an account' })

const MIN_PASSWORD = 10

const route = useRoute()
const auth = useAuth()

const username = ref('')
const password = ref('')
const confirm = ref('')
const busy = ref(false)
const errors = reactive({ username: '', password: '', confirm: '' })
const inputs = {
	username: useTemplateRef('usernameInput'),
	password: useTemplateRef('passwordInput'),
	confirm: useTemplateRef('confirmInput')
}

const loginLink = computed(() => ({
	path: '/login',
	query: route.query.redirect ? { redirect: route.query.redirect } : {}
}))

watch([username, password, confirm], () => Object.assign(errors, { username: '', password: '', confirm: '' }))

const fail = async (field, message) => {
	errors[field] = message
	await nextTick()
	inputs[field].value?.inputRef?.focus()
}

const submit = async () => {
	if (busy.value) return
	if (!username.value.trim()) return fail('username', 'Choose a username.')
	if (password.value.length < MIN_PASSWORD) return fail('password', `Use at least ${MIN_PASSWORD} characters.`)
	if (confirm.value !== password.value) return fail('confirm', 'The two passwords don’t match.')
	busy.value = true
	try {
		await auth.signUp(username.value.trim(), password.value, confirm.value)
		clearNuxtState((key) => key.startsWith('cf-'), { reset: true })
		// Back to an invite link if that's where the person came from; otherwise add Cloudflare.
		const target = route.query.redirect ? safeRedirect(route.query.redirect) : '/connections'
		await navigateTo(target, { replace: true })
	} catch (error) {
		const message = describeError(error, 'Couldn’t create the account. Try again.')
		await fail(
			/username/i.test(message) ? 'username' : /password/i.test(message) ? 'password' : 'username',
			message
		)
	} finally {
		busy.value = false
	}
}
</script>
