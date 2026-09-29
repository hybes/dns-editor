<template>
	<UDashboardPanel id="sharing">
		<template #header>
			<UDashboardNavbar title="Sharing">
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
				<template #right>
					<UTooltip text="Refresh sharing">
						<UButton
							icon="i-lucide-refresh-cw"
							color="neutral"
							variant="ghost"
							aria-label="Refresh sharing"
							:loading="loading"
							@click="load"
						/>
					</UTooltip>
					<UButton
						v-if="canShare"
						icon="i-lucide-user-plus"
						label="Share domains"
						@click="openEditor(null)"
					/>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="flex max-w-3xl flex-col gap-8">
				<p class="text-muted text-sm text-pretty">
					Give someone access to some of your domains, with the level you choose for each part of each domain.
					They sign in with their own DNS Manager account. Your Cloudflare connection does the work, and its
					token never leaves this server.
				</p>

				<UAlert
					v-if="error"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					title="Couldn’t load sharing"
					:description="error"
					:actions="[
						{
							label: 'Try again',
							icon: 'i-lucide-refresh-cw',
							color: 'neutral',
							variant: 'outline',
							loading,
							onClick: load
						}
					]"
				/>

				<div v-else-if="!loaded" class="flex flex-col gap-3" aria-busy="true">
					<span class="sr-only" role="status">Loading sharing…</span>
					<USkeleton v-for="row in 3" :key="row" class="h-12 w-full" />
				</div>

				<template v-else>
					<section v-if="canShare" aria-labelledby="sharing-owned" class="flex flex-col gap-3">
						<h2 id="sharing-owned" class="text-highlighted font-semibold">People you share with</h2>
						<UEmpty
							v-if="!owned.length"
							variant="naked"
							icon="i-lucide-users"
							title="You haven’t shared any domains"
							description="Share some of your domains with a friend or a customer, and choose what they can see and change."
							:actions="[
								{ label: 'Share domains', icon: 'i-lucide-user-plus', onClick: () => openEditor(null) }
							]"
						/>
						<ul v-else class="divide-default border-default divide-y border-y">
							<li
								v-for="share in owned"
								:key="share.id"
								class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
							>
								<div class="min-w-0 flex-1">
									<p class="text-highlighted flex flex-wrap items-center gap-2 font-medium">
										{{ share.label }}
										<UBadge
											v-if="share.member"
											:label="share.member"
											color="neutral"
											variant="subtle"
											size="sm"
										/>
										<UBadge
											v-else
											:label="
												share.invite?.expired ? 'Invite expired' : 'Invite not accepted yet'
											"
											:color="share.invite?.expired ? 'warning' : 'neutral'"
											variant="outline"
											size="sm"
										/>
									</p>
									<p class="text-muted text-sm">
										{{ plural(share.zones.length, 'domain') }} · {{ summary(share) }}
									</p>
								</div>
								<div class="flex shrink-0 flex-wrap gap-1.5">
									<UButton
										v-if="!share.member"
										:label="share.invite?.expired ? 'New invite link' : 'Copy a new invite link'"
										icon="i-lucide-link"
										color="neutral"
										variant="outline"
										size="sm"
										:loading="renewing === share.id"
										@click="renewInvite(share)"
									/>
									<UButton
										label="Edit"
										icon="i-lucide-pencil"
										color="neutral"
										variant="outline"
										size="sm"
										@click="openEditor(share)"
									/>
									<UButton
										label="Remove"
										icon="i-lucide-trash-2"
										color="error"
										variant="soft"
										size="sm"
										@click="askRemove(share)"
									/>
								</div>
							</li>
						</ul>
						<p v-if="owned.some((share) => !share.member)" class="text-muted text-xs text-pretty">
							Invite links are shown once, when you make them. A new link stops the old one working.
						</p>
					</section>

					<section v-if="received.length" aria-labelledby="sharing-received" class="flex flex-col gap-3">
						<h2 id="sharing-received" class="text-highlighted font-semibold">Shared with you</h2>
						<ul class="divide-default border-default divide-y border-y">
							<li
								v-for="share in received"
								:key="share.id"
								class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
							>
								<div class="min-w-0 flex-1">
									<p class="text-highlighted font-medium">From {{ share.owner }}</p>
									<p class="text-muted text-sm">{{ plural(share.zoneCount, 'domain') }}</p>
								</div>
								<UButton
									label="Leave"
									icon="i-lucide-log-out"
									color="neutral"
									variant="outline"
									size="sm"
									class="self-start sm:self-auto"
									@click="askLeave(share)"
								/>
							</li>
						</ul>
					</section>

					<UEmpty
						v-if="!canShare && !received.length"
						variant="naked"
						icon="i-lucide-users"
						title="Nothing shared yet"
						description="Add a Cloudflare connection to share your own domains, or ask someone for an invite link to theirs."
						:actions="[{ label: 'Open connections', icon: 'i-lucide-key-round', to: '/connections' }]"
					/>
				</template>
			</div>

			<SharingShareEditor v-model:open="editorOpen" :share="editing" :zones="ownZones" @saved="load" />

			<AccountDeleteModal
				v-model:open="removeOpen"
				:title="removeTarget ? `Stop sharing with ${removeTarget.label}?` : 'Stop sharing?'"
				:description="
					removeTarget?.member
						? `${removeTarget.member} loses access to ${plural(removeTarget.zones.length, 'domain')} at once.`
						: 'The invite link stops working.'
				"
				confirm-label="Stop sharing"
				error-title="Couldn’t remove the share"
				:action="remove"
			/>

			<AccountDeleteModal
				v-model:open="leaveOpen"
				:title="leaveTarget ? `Leave ${leaveTarget.owner}’s domains?` : 'Leave?'"
				description="They disappear from your list. You’ll need a new invite link to get them back."
				confirm-label="Leave"
				error-title="Couldn’t leave the share"
				:action="leave"
			/>
		</template>
	</UDashboardPanel>
</template>

<script setup>
import { describeLevels } from '#shared/utils/access'

// Sharing: the shares this account has made, each with its domains, levels and invite, and the
// ones others have made with it.
useSeoMeta({ title: 'Sharing' })

const auth = useAuth()
const { call } = useCfApi()
const notify = useNotify()
const { zones, load: loadZones } = useZones()

const owned = ref([])
const received = ref([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')

const canShare = computed(() => auth.connections.value.length > 0)
// Only zones the account's own connections see can be shared, not ones shared with it.
const ownZones = computed(() => zones.value.filter((zone) => !zone.shared))

const load = async () => {
	loading.value = true
	error.value = ''
	try {
		const response = await call('shares/list', {}, { fallback: 'Couldn’t load sharing' })
		owned.value = response?.result?.owned || []
		received.value = response?.result?.received || []
		loaded.value = true
	} catch (reason) {
		error.value = describeError(reason, 'Couldn’t load sharing. Try again.')
	} finally {
		loading.value = false
	}
}

onMounted(() => {
	load()
	if (canShare.value) loadZones()
})

const summary = (share) => {
	const overridden = share.zones.filter((zone) => Object.keys(zone.overrides).length).length
	return [
		describeLevels(share.defaults),
		overridden ? `${plural(overridden, 'domain')} set differently` : '',
		share.showPrices ? 'prices shown' : ''
	]
		.filter(Boolean)
		.join(' · ')
}

const editorOpen = ref(false)
const editing = ref(null)
const openEditor = (share) => {
	editing.value = share
	editorOpen.value = true
}

const renewing = ref(null)
const renewInvite = async (share) => {
	renewing.value = share.id
	try {
		const response = await call('shares/invite', { id: share.id }, { fallback: 'Couldn’t make a new invite link' })
		const url = `${window.location.origin}/invite/${response.result.inviteToken}`
		await notify.copy(url, 'Invite link')
		await load()
	} catch (reason) {
		notify.error('Couldn’t make a new invite link', reason)
	} finally {
		renewing.value = null
	}
}

const removeOpen = ref(false)
const removeTarget = ref(null)
const askRemove = (share) => {
	removeTarget.value = share
	removeOpen.value = true
}
const remove = async () => {
	await call('shares/remove', { id: removeTarget.value.id }, { fallback: 'Couldn’t remove the share' })
	notify.success('Stopped sharing', removeTarget.value.label)
	await load()
}

const leaveOpen = ref(false)
const leaveTarget = ref(null)
const askLeave = (share) => {
	leaveTarget.value = share
	leaveOpen.value = true
}
const leave = async () => {
	await call('shares/leave', { id: leaveTarget.value.id }, { fallback: 'Couldn’t leave the share' })
	notify.success('Left the share', `From ${leaveTarget.value.owner}`)
	await load()
	await auth.load({ force: true })
	clearNuxtState((key) => key.startsWith('cf-'), { reset: true })
}
</script>
