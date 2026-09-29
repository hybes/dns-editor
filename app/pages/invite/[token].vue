<template>
	<AuthShell :title="title">
		<div v-if="!info" class="flex flex-col gap-3" aria-busy="true">
			<span class="sr-only" role="status">Checking the invite…</span>
			<USkeleton class="h-5 w-full" />
			<USkeleton class="h-10 w-full" />
		</div>

		<div v-else-if="!info.valid" class="flex flex-col gap-4">
			<p class="text-muted text-pretty">{{ info.reason }}</p>
			<UButton
				:to="auth.user.value ? '/zones' : '/login'"
				:label="auth.user.value ? 'Go to your zones' : 'Sign in'"
				block
				size="lg"
			/>
		</div>

		<div v-else class="flex flex-col gap-4">
			<p class="text-default text-pretty">
				<span class="text-highlighted font-medium">{{ info.owner }}</span> is sharing
				{{ plural(info.zoneCount, 'domain') }} with you in DNS Manager.
			</p>
			<template v-if="auth.user.value">
				<p class="text-muted text-sm">
					You’re signed in as <span class="text-default">{{ auth.user.value.username }}</span
					>. Accepting adds the domains to your list.
				</p>
				<UAlert
					v-if="error"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					:description="error"
					role="alert"
				/>
				<UButton label="Accept" size="lg" block :loading="accepting" @click="accept" />
			</template>
			<template v-else>
				<p class="text-muted text-sm">Create a DNS Manager account, or sign in to yours, to accept.</p>
				<UButton
					:to="{ path: '/signup', query: { redirect: route.fullPath } }"
					label="Create an account"
					size="lg"
					block
				/>
				<UButton
					:to="{ path: '/login', query: { redirect: route.fullPath } }"
					label="Sign in"
					size="lg"
					block
					color="neutral"
					variant="outline"
				/>
			</template>
		</div>
	</AuthShell>
</template>

<script setup>
// An invite link: /invite/<token>. It says who is sharing what, then accepts for the signed-in
// account, or sends the person to create an account or sign in and brings them back here.
definePageMeta({ layout: false })
useSeoMeta({ title: 'Invite' })

const route = useRoute()
const auth = useAuth()
const notify = useNotify()

const info = ref(null)
const accepting = ref(false)
const error = ref('')

const title = computed(() =>
	info.value?.valid ? 'You’ve been invited' : info.value ? 'This invite can’t be used' : 'Invite'
)

onMounted(async () => {
	try {
		const response = await $fetch('/api/auth/invite', {
			method: 'POST',
			body: { token: String(route.params.token || '') },
			timeout: 30_000
		})
		info.value = response?.result || { valid: false, reason: 'This invite link isn’t valid.' }
	} catch (reason) {
		info.value = { valid: false, reason: describeError(reason, 'Couldn’t check the invite. Try again.') }
	}
})

const accept = async () => {
	accepting.value = true
	error.value = ''
	try {
		const response = await $fetch('/api/shares/accept', {
			method: 'POST',
			body: { token: String(route.params.token || '') },
			timeout: 30_000
		})
		await auth.load({ force: true })
		clearNuxtState((key) => key.startsWith('cf-'), { reset: true })
		notify.success(
			`${response.result.owner} is sharing domains with you`,
			plural(response.result.zoneCount, 'domain')
		)
		await navigateTo('/zones', { replace: true })
	} catch (reason) {
		error.value = describeError(reason, 'Couldn’t accept the invite. Try again.')
	} finally {
		accepting.value = false
	}
}
</script>
