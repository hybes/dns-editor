<template>
	<UDashboardPanel id="account">
		<template #header>
			<UDashboardNavbar title="Your account">
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="flex max-w-md flex-col gap-6">
				<p class="text-muted text-sm">
					Signed in as <span class="text-highlighted font-medium">{{ auth.user.value?.username }}</span>
				</p>

				<form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
					<h2 class="text-highlighted font-semibold">Change password</h2>
					<UFormField label="Current password" :error="errors.current || undefined">
						<UInput
							v-model="current"
							type="password"
							autocomplete="current-password"
							name="current-password"
							class="w-full"
						/>
					</UFormField>
					<UFormField
						label="New password"
						help="At least 10 characters."
						:error="errors.password || undefined"
					>
						<UInput
							v-model="password"
							type="password"
							autocomplete="new-password"
							name="new-password"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="New password again" :error="errors.confirm || undefined">
						<UInput
							v-model="confirm"
							type="password"
							autocomplete="new-password"
							name="confirm-password"
							class="w-full"
						/>
					</UFormField>
					<p class="text-muted text-sm">Changing it signs you out everywhere else.</p>
					<UButton type="submit" label="Change password" :loading="busy" class="self-start" />
				</form>

				<section aria-labelledby="account-delete" class="border-default flex flex-col gap-3 border-t pt-6">
					<h2 id="account-delete" class="text-highlighted font-semibold">Delete your account</h2>
					<p class="text-muted text-sm text-pretty">
						Removes your account, its Cloudflare connections and everything you share. People you share with
						lose access at once. Your tokens keep working in Cloudflare until you delete them there.
					</p>
					<UButton
						label="Delete account"
						icon="i-lucide-trash-2"
						color="error"
						variant="soft"
						class="self-start"
						@click="deleteOpen = true"
					/>
				</section>
			</div>

			<AccountDeleteModal
				v-model:open="deleteOpen"
				title="Delete your DNS Manager account?"
				description="This can’t be undone."
				confirm-label="Delete account"
				error-title="Couldn’t delete the account"
				:action="deleteAccount"
			>
				<UFormField label="Your password" class="mt-2">
					<UInput
						v-model="deletePassword"
						type="password"
						autocomplete="current-password"
						name="delete-password"
						class="w-full"
					/>
				</UFormField>
			</AccountDeleteModal>
		</template>
	</UDashboardPanel>
</template>

<script setup>
// The signed-in account: changing its password, which also ends its other sessions, and
// deleting it.
useSeoMeta({ title: 'Your account' })

const MIN_PASSWORD = 10

const auth = useAuth()
const notify = useNotify()
const { logout } = useSession()

const deleteOpen = ref(false)
const deletePassword = ref('')
watch(deleteOpen, (open) => {
	if (!open) deletePassword.value = ''
})

// Throws to keep the confirmation open with the server's message.
const deleteAccount = async () => {
	await $fetch('/api/auth/delete', { method: 'POST', body: { password: deletePassword.value }, timeout: 30_000 })
	notify.success('Account deleted')
	await logout()
}

const current = ref('')
const password = ref('')
const confirm = ref('')
const busy = ref(false)
const errors = reactive({ current: '', password: '', confirm: '' })

watch([current, password, confirm], () => Object.assign(errors, { current: '', password: '', confirm: '' }))

const submit = async () => {
	if (busy.value) return
	if (!current.value) return (errors.current = 'Enter your current password.')
	if (password.value.length < MIN_PASSWORD) return (errors.password = `Use at least ${MIN_PASSWORD} characters.`)
	if (confirm.value !== password.value) return (errors.confirm = 'The two passwords don’t match.')
	busy.value = true
	try {
		await $fetch('/api/auth/password', {
			method: 'POST',
			body: { current: current.value, password: password.value },
			timeout: 30_000
		})
		current.value = ''
		password.value = ''
		confirm.value = ''
		notify.success('Password changed', 'You’re signed out everywhere else.')
	} catch (error) {
		const message = describeError(error, 'Couldn’t change the password. Try again.')
		if (/current/i.test(message)) errors.current = message
		else errors.password = message
	} finally {
		busy.value = false
	}
}
</script>
