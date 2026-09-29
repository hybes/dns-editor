<template>
	<UDashboardPanel id="connections">
		<template #header>
			<UDashboardNavbar title="Cloudflare connections">
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="flex max-w-3xl flex-col gap-8">
				<p class="text-muted text-sm text-pretty">
					Each connection is a Cloudflare API token. Add one for each Cloudflare login or account you manage,
					and their zones appear together under your DNS Manager account. Tokens stay on this server,
					encrypted.
				</p>

				<section v-if="connections.length" aria-labelledby="connections-list" class="flex flex-col gap-3">
					<h2 id="connections-list" class="text-highlighted font-semibold">Your connections</h2>
					<ul class="divide-default border-default divide-y border-y">
						<li
							v-for="connection in connections"
							:key="connection.id"
							class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
						>
							<form
								v-if="renaming === connection.id"
								class="flex min-w-0 flex-1 items-start gap-2"
								@submit.prevent="saveName(connection)"
							>
								<UFormField
									:label="`Name for ${connection.label}`"
									:error="renameError || undefined"
									class="min-w-0 flex-1"
									:ui="{ labelWrapper: 'sr-only', container: 'mt-0' }"
								>
									<UInput v-model="newName" autofocus class="w-full" maxlength="80" />
								</UFormField>
								<UButton type="submit" label="Save" :loading="saving" />
								<UButton label="Cancel" color="neutral" variant="ghost" @click="renaming = null" />
							</form>
							<div v-else class="min-w-0 flex-1">
								<p class="text-highlighted font-medium break-words">{{ connection.label }}</p>
								<p class="text-muted text-sm">
									Token ending <span class="font-mono">{{ connection.hint.replace('…', '') }}</span> ·
									added
									{{ formatDate(`${connection.createdAt}Z`) }}
								</p>
							</div>
							<div v-if="renaming !== connection.id" class="flex shrink-0 gap-1.5">
								<UButton
									label="Rename"
									icon="i-lucide-pencil"
									color="neutral"
									variant="outline"
									size="sm"
									@click="startRename(connection)"
								/>
								<UButton
									label="Remove"
									icon="i-lucide-trash-2"
									color="error"
									variant="soft"
									size="sm"
									@click="askRemove(connection)"
								/>
							</div>
						</li>
					</ul>
				</section>

				<section aria-labelledby="connections-add" class="flex flex-col gap-4">
					<div class="flex flex-col gap-1">
						<h2 id="connections-add" class="text-highlighted font-semibold">
							{{ connections.length ? 'Add another connection' : 'Connect Cloudflare' }}
						</h2>
						<p v-if="!connections.length" class="text-muted text-sm text-pretty">
							Add a Cloudflare API token to see your zones. You can add more later, one for each
							Cloudflare login or account.
						</p>
					</div>
					<ConnectionsAddConnection :autofocus="!connections.length" @added="onAdded" />
				</section>
			</div>

			<AccountDeleteModal
				v-model:open="removeOpen"
				:title="removeTarget ? `Remove ${removeTarget.label}?` : 'Remove the connection?'"
				description="DNS Manager forgets this token, and its zones disappear from your list. The token keeps working in Cloudflare until you delete it there."
				confirm-label="Remove connection"
				error-title="Couldn’t remove the connection"
				:action="remove"
			/>
		</template>
	</UDashboardPanel>
</template>

<script setup>
// The signed-in account's Cloudflare connections: one per API token, each able to see some
// accounts and zones. The zones list adds them all up.
useSeoMeta({ title: 'Cloudflare connections' })

const auth = useAuth()
const { call } = useCfApi()
const notify = useNotify()

const connections = computed(() => auth.connections.value)

// Cloudflare data cached for the old set of connections must not carry over.
const refresh = async () => {
	await auth.load({ force: true })
	clearNuxtState((key) => key.startsWith('cf-'), { reset: true })
}

const onAdded = async () => {
	const first = !connections.value.length
	await refresh()
	if (first) await navigateTo('/zones')
}

const renaming = ref(null)
const newName = ref('')
const renameError = ref('')
const saving = ref(false)

const startRename = (connection) => {
	renaming.value = connection.id
	newName.value = connection.label
	renameError.value = ''
}

const saveName = async (connection) => {
	if (!newName.value.trim()) {
		renameError.value = 'Enter a name.'
		return
	}
	saving.value = true
	try {
		await call('connections/rename', { id: connection.id, label: newName.value.trim() })
		renaming.value = null
		await refresh()
	} catch (error) {
		renameError.value = describeError(error, 'Couldn’t rename it. Try again.')
	} finally {
		saving.value = false
	}
}

const removeOpen = ref(false)
const removeTarget = ref(null)

const askRemove = (connection) => {
	removeTarget.value = connection
	removeOpen.value = true
}

const remove = async () => {
	await call('connections/remove', { id: removeTarget.value.id }, { fallback: 'Couldn’t remove the connection' })
	notify.success('Connection removed', removeTarget.value.label)
	await refresh()
}
</script>
