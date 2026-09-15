<template>
	<UDashboardPanel id="zone-overview">
		<template #header>
			<UDashboardNavbar :title="zoneName || 'Overview'">
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
				<template #right>
					<UTooltip text="Refresh from Cloudflare">
						<UButton
							icon="i-lucide-refresh-cw"
							color="neutral"
							variant="ghost"
							:loading="refreshing"
							:aria-label="
								zoneName ? `Refresh ${zoneName} from Cloudflare` : 'Refresh zone from Cloudflare'
							"
							@click="refreshAll"
						/>
					</UTooltip>
					<UButton
						label="Records"
						icon="i-lucide-list"
						color="neutral"
						variant="outline"
						:to="`/zones/${zoneId}/records`"
					/>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="mx-auto flex w-full max-w-3xl flex-col gap-10">
				<UAlert
					v-if="error"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					:title="zone ? 'Couldn’t load the latest zone details' : 'Couldn’t load this zone'"
					:description="error"
					:actions="[
						{
							label: 'Try again',
							icon: 'i-lucide-refresh-cw',
							color: 'neutral',
							variant: 'outline',
							loading,
							onClick: retryZone
						}
					]"
				/>

				<div v-if="!zone && !error" class="flex flex-col gap-10" aria-busy="true">
					<span class="sr-only">Loading zone…</span>
					<div v-for="n in 3" :key="n" class="flex flex-col gap-3">
						<USkeleton class="h-5 w-40" />
						<USkeleton class="h-28 w-full" />
					</div>
				</div>

				<template v-else-if="zone">
					<section aria-labelledby="zone-heading" class="flex flex-col gap-3">
						<h2 id="zone-heading" class="text-highlighted text-base font-semibold">Zone</h2>
						<dl class="divide-default border-default divide-y border-y text-sm">
							<div :class="rowClass">
								<dt class="text-muted">Domain</dt>
								<dd class="text-highlighted min-w-0 font-medium break-all">{{ zone.name }}</dd>
							</div>
							<div :class="rowClass">
								<dt class="text-muted">Status</dt>
								<dd class="flex min-w-0 flex-col gap-1.5">
									<div class="flex flex-wrap items-center gap-2">
										<UBadge :color="status.color" variant="subtle" :label="status.label" />
										<UBadge v-if="zone.paused" color="neutral" variant="outline" label="Paused" />
									</div>
									<p v-if="statusExplanation" class="text-muted">{{ statusExplanation }}</p>
									<p v-if="zone.paused" class="text-muted">
										Paused zones only use Cloudflare for DNS, so proxied records don’t get
										Cloudflare’s security or performance features.
									</p>
								</dd>
							</div>
							<div v-if="zone.plan?.name" :class="rowClass">
								<dt class="text-muted">Plan</dt>
								<dd class="text-default">{{ zone.plan.name }}</dd>
							</div>
							<div v-if="zone.type" :class="rowClass">
								<dt class="text-muted">Setup</dt>
								<dd class="text-default">{{ setupLabel }}</dd>
							</div>
							<div v-if="zone.created_on" :class="rowClass">
								<dt class="text-muted">Added to Cloudflare</dt>
								<dd class="text-default">
									<time :datetime="zone.created_on">{{
										formatDate(zone.created_on, 'datetime')
									}}</time>
								</dd>
							</div>
							<div :class="rowClass">
								<dt class="text-muted">Activated</dt>
								<dd class="text-default">
									<time v-if="zone.activated_on" :datetime="zone.activated_on">
										{{ formatDate(zone.activated_on, 'datetime') }}
									</time>
									<span v-else class="text-muted">Not activated yet</span>
								</dd>
							</div>
							<div :class="rowClass">
								<dt class="text-muted">Zone ID</dt>
								<dd class="flex min-w-0 items-center gap-1">
									<code class="text-default font-mono break-all">{{ zone.id }}</code>
									<UButton
										icon="i-lucide-copy"
										size="xs"
										color="neutral"
										variant="ghost"
										:aria-label="`Copy zone ID for ${zone.name}`"
										@click="copy(zone.id, 'Zone ID')"
									/>
								</dd>
							</div>
							<div v-if="zone.account?.id" :class="rowClass">
								<dt class="text-muted">Account</dt>
								<dd class="flex min-w-0 flex-col gap-0.5">
									<span v-if="zone.account.name" class="text-default break-words">
										{{ zone.account.name }}
									</span>
									<span class="flex min-w-0 items-center gap-1">
										<code class="text-muted font-mono break-all">{{ zone.account.id }}</code>
										<UButton
											icon="i-lucide-copy"
											size="xs"
											color="neutral"
											variant="ghost"
											:aria-label="`Copy account ID for ${zone.account.name || zone.name}`"
											@click="copy(zone.account.id, 'Account ID')"
										/>
									</span>
								</dd>
							</div>
						</dl>
					</section>

					<section aria-labelledby="ns-heading" class="flex flex-col gap-3">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<h2 id="ns-heading" class="text-highlighted text-base font-semibold">Name servers</h2>
							<UButton
								v-if="nameServers.length > 1"
								label="Copy all"
								icon="i-lucide-copy"
								size="sm"
								color="neutral"
								variant="outline"
								@click="copy(nameServers.join('\n'), 'Name servers')"
							/>
						</div>
						<p v-if="showOriginalNameServers" class="text-muted text-sm">
							At your domain’s registrar, replace the current name servers with Cloudflare’s. Registrars
							can take up to 24 hours to apply the change.
						</p>
						<dl v-if="nameServers.length" class="divide-default border-default divide-y border-y text-sm">
							<div :class="rowClass">
								<dt class="text-muted">{{ showOriginalNameServers ? 'Change to' : 'Cloudflare' }}</dt>
								<dd class="min-w-0">
									<ul class="flex flex-col gap-1">
										<li
											v-for="server in nameServers"
											:key="server"
											class="flex min-w-0 items-center gap-1"
										>
											<code class="text-highlighted font-mono break-all">{{ server }}</code>
											<UButton
												icon="i-lucide-copy"
												size="xs"
												color="neutral"
												variant="ghost"
												:aria-label="`Copy name server ${server}`"
												@click="copy(server, 'Name server')"
											/>
										</li>
									</ul>
								</dd>
							</div>
							<div v-if="showOriginalNameServers" :class="rowClass">
								<dt class="text-muted">Replace</dt>
								<dd class="min-w-0">
									<ul class="flex flex-col gap-1">
										<li
											v-for="server in zone.original_name_servers"
											:key="server"
											class="text-muted py-0.5 font-mono break-all"
										>
											{{ server }}
										</li>
									</ul>
								</dd>
							</div>
						</dl>
						<p v-else class="text-muted text-sm">
							{{
								zone.type === 'partial'
									? 'This zone uses a CNAME setup, so your own DNS provider stays authoritative and Cloudflare assigns no name servers.'
									: 'Cloudflare didn’t return name servers for this zone.'
							}}
						</p>
					</section>

					<section aria-labelledby="ssl-heading" class="flex flex-col gap-3">
						<div class="flex flex-col gap-1">
							<h2 id="ssl-heading" class="text-highlighted text-base font-semibold">
								SSL/TLS encryption
							</h2>
							<p class="text-muted text-sm">
								Applies to proxied records. DNS-only records send visitors straight to your server.
							</p>
						</div>

						<div v-if="!capabilitiesLoaded" class="flex flex-col gap-2" aria-busy="true">
							<span class="sr-only">Checking access to SSL settings…</span>
							<USkeleton v-for="n in 4" :key="n" class="h-12 w-full" />
						</div>
						<UAlert
							v-else-if="!capabilities"
							role="alert"
							color="warning"
							variant="subtle"
							icon="i-lucide-triangle-alert"
							title="Couldn’t check whether this token can change this setting"
							description="The feature check didn’t finish. Check your connection and try again."
							:actions="[
								{
									label: 'Check again',
									icon: 'i-lucide-refresh-cw',
									color: 'neutral',
									variant: 'outline',
									loading,
									onClick: retryZone
								}
							]"
						/>
						<div v-else-if="!can('ssl')" class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
							<p class="text-muted">Not available with this token. {{ unavailableReason('ssl') }}</p>
							<UButton
								label="Check again"
								size="xs"
								color="neutral"
								variant="outline"
								:loading="loading"
								@click="retryZone"
							/>
						</div>
						<div v-else-if="!hasDetails" class="flex flex-col gap-2" :aria-busy="loading">
							<template v-if="loading">
								<span class="sr-only">Loading the encryption mode…</span>
								<USkeleton v-for="n in 4" :key="n" class="h-12 w-full" />
							</template>
							<p v-else class="text-muted text-sm">
								The zone details didn’t load, so the current mode is unknown.
							</p>
						</div>
						<UAlert
							v-else-if="sslReadError"
							color="warning"
							variant="subtle"
							icon="i-lucide-triangle-alert"
							title="Couldn’t read the current encryption mode"
							:description="sslReadError"
							:actions="[
								{
									label: 'Try again',
									icon: 'i-lucide-refresh-cw',
									color: 'neutral',
									variant: 'outline',
									loading,
									onClick: retryZone
								}
							]"
						/>
						<form v-else class="flex flex-col gap-3" @submit.prevent="requestSslChange">
							<p v-if="sslUnrecognised" class="text-muted text-sm">
								Cloudflare reports the mode as “{{ currentSsl }}”, which this page doesn’t recognise.
								Saving a mode below replaces it.
							</p>
							<URadioGroup
								v-model="sslDraft"
								:items="SSL_MODES"
								variant="table"
								legend="Encryption mode"
								:disabled="sslSaving || !sslEditable"
								:ui="{ legend: 'sr-only' }"
							>
								<template #label="{ item }">
									<span class="flex flex-wrap items-center gap-2">
										{{ item.label }}
										<UBadge
											v-if="item.value === currentSsl"
											color="neutral"
											variant="outline"
											size="sm"
											label="Current"
										/>
									</span>
								</template>
							</URadioGroup>
							<p v-if="!sslEditable" class="text-muted text-sm">
								Cloudflare doesn’t allow this setting to be changed on this zone.
							</p>
							<div class="flex flex-wrap items-center justify-between gap-3">
								<p class="text-muted text-sm">
									<template v-if="zone.ssl.modified_on">
										Last changed
										<time :datetime="zone.ssl.modified_on">{{
											formatDate(zone.ssl.modified_on, 'datetime')
										}}</time>
									</template>
								</p>
								<UButton
									type="submit"
									label="Save encryption mode"
									:loading="sslSaving"
									:disabled="!sslChanged || !sslEditable"
								/>
							</div>
						</form>
					</section>

					<section aria-labelledby="bot-heading" class="flex flex-col gap-3">
						<h2 id="bot-heading" class="text-highlighted text-base font-semibold">Bot Fight Mode</h2>

						<div v-if="!capabilitiesLoaded" aria-busy="true">
							<span class="sr-only">Checking access to Bot Fight Mode…</span>
							<USkeleton class="h-14 w-full" />
						</div>
						<UAlert
							v-else-if="!capabilities"
							role="alert"
							color="warning"
							variant="subtle"
							icon="i-lucide-triangle-alert"
							title="Couldn’t check whether this token can change this setting"
							description="The feature check didn’t finish. Check your connection and try again."
							:actions="[
								{
									label: 'Check again',
									icon: 'i-lucide-refresh-cw',
									color: 'neutral',
									variant: 'outline',
									loading,
									onClick: retryZone
								}
							]"
						/>
						<div
							v-else-if="!can('botFightMode')"
							class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
						>
							<p class="text-muted">
								Not available with this token. {{ unavailableReason('botFightMode') }}
							</p>
							<UButton
								label="Check again"
								size="xs"
								color="neutral"
								variant="outline"
								:loading="loading"
								@click="retryZone"
							/>
						</div>
						<div v-else-if="botLoading && !botLoaded" aria-busy="true">
							<span class="sr-only">Loading Bot Fight Mode…</span>
							<USkeleton class="h-14 w-full" />
						</div>
						<UAlert
							v-else-if="botError"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							title="Couldn’t load Bot Fight Mode"
							:description="botError"
							:actions="[
								{
									label: 'Try again',
									icon: 'i-lucide-refresh-cw',
									color: 'neutral',
									variant: 'outline',
									loading: botLoading,
									onClick: () => loadBot({ fresh: true })
								}
							]"
						/>
						<p v-else-if="botUnsupported" class="text-muted text-sm">
							Cloudflare didn’t return a Bot Fight Mode setting for this zone. Paid plans use Super Bot
							Fight Mode or Bot Management instead, which this app doesn’t manage.
						</p>
						<USwitch
							v-else-if="botLoaded"
							:model-value="botEnabled"
							:loading="botSaving"
							:disabled="botSaving"
							label="Bot Fight Mode"
							description="Challenges requests that match patterns of known bots across the whole zone. It can also challenge legitimate automated traffic, such as monitoring or API clients, and rules can’t skip it."
							:ui="{ root: 'border-default rounded-md border p-3', label: 'sr-only' }"
							@update:model-value="setBotFightMode"
						/>
					</section>

					<section v-if="relatedLinks.length" aria-labelledby="related-heading" class="flex flex-col gap-3">
						<h2 id="related-heading" class="text-highlighted text-base font-semibold">Related tools</h2>
						<ul class="flex flex-col gap-2 text-sm">
							<li v-for="link in relatedLinks" :key="link.label">
								<ULink
									raw
									:to="link.to"
									:target="link.target"
									class="text-primary focus-visible:outline-primary inline-flex items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
								>
									{{ link.label }}
									<UIcon v-if="link.target" name="i-lucide-external-link" class="size-3.5 shrink-0" />
									<span v-if="link.target" class="sr-only">(opens in a new tab)</span>
								</ULink>
							</li>
						</ul>
					</section>
				</template>
			</div>

			<UModal
				v-model:open="sslConfirmOpen"
				:title="pendingSsl === 'off' ? 'Turn off encryption?' : 'Switch to Flexible?'"
				:dismissible="!sslSaving"
				:close="!sslSaving"
			>
				<template #body>
					<div class="flex flex-col gap-3 text-sm">
						<p v-if="pendingSsl === 'off'" class="text-default">
							Visitors will reach <span class="text-highlighted font-medium">{{ zoneName }}</span> over
							plain HTTP. Browsers will mark it as not secure, and anything visitors send, such as
							passwords, can be read or changed in transit.
						</p>
						<p v-else class="text-default">
							Traffic between Cloudflare and the origin servers for
							<span class="text-highlighted font-medium">{{ zoneName }}</span> will travel unencrypted.
							Visitors still see a padlock, but anyone on that network path can read or change the
							traffic.
						</p>
						<UAlert
							v-if="sslModalError"
							role="alert"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							title="Cloudflare didn’t change the mode"
							:description="sslModalError"
						/>
					</div>
				</template>
				<template #footer>
					<div class="flex w-full flex-wrap justify-end gap-2">
						<UButton
							label="Keep current mode"
							color="neutral"
							variant="ghost"
							:disabled="sslSaving"
							@click="sslConfirmOpen = false"
						/>
						<UButton
							:label="pendingSsl === 'off' ? 'Turn off encryption' : 'Switch to Flexible'"
							color="error"
							:loading="sslSaving"
							@click="saveSsl(pendingSsl)"
						/>
					</div>
				</template>
			</UModal>
		</template>
	</UDashboardPanel>
</template>

<script setup>
const SSL_MODES = [
	{
		value: 'off',
		label: 'Off',
		description: 'No HTTPS. Visitors connect over plain HTTP and browsers mark the site as not secure.'
	},
	{
		value: 'flexible',
		label: 'Flexible',
		description:
			'Encrypts traffic between visitors and Cloudflare, but Cloudflare connects to your server over plain HTTP.'
	},
	{
		value: 'full',
		label: 'Full',
		description:
			'Encrypts traffic end to end, but Cloudflare accepts any certificate on your server, including self-signed or expired ones.'
	},
	{
		value: 'strict',
		label: 'Full (strict)',
		description:
			'Encrypts traffic end to end and requires a valid certificate on your server from a public certificate authority or Cloudflare Origin CA.'
	}
]
// Higher is stronger; only moves down to Flexible or Off ask for confirmation.
const SSL_RANK = { off: 0, flexible: 1, full: 2, strict: 3 }

const rowClass = 'grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6'

const route = useRoute()
const { call } = useCfApi()
const { copy, success: notifySuccess, error: notifyError } = useNotify()

const {
	zoneId,
	zone,
	zoneName,
	loading,
	error,
	capabilitiesLoaded,
	capabilities,
	missingCapabilities,
	can,
	load,
	refresh
} = useZone(() => route.params.zone_id)

useSeoMeta({ title: () => (zoneName.value ? `Overview · ${zoneName.value}` : 'Overview') })

watch(
	zoneId,
	(id) => {
		if (id) load()
	},
	{ immediate: true }
)

// The zones list fills `zone` before its details arrive; only the details carry `ssl`.
const hasDetails = computed(() => Boolean(zone.value?.ssl))

const status = computed(() => zoneStatusBadge(zone.value?.status))

const statusExplanation = computed(() => {
	const current = zone.value
	if (!current?.status || current.status === 'active') return ''
	if (current.status === 'pending') {
		if (current.type === 'partial') {
			return 'Cloudflare hasn’t verified this CNAME setup yet. Check the verification TXT record at your DNS provider.'
		}
		if (current.type === 'secondary') return 'Cloudflare hasn’t activated this secondary zone yet.'
		return 'Cloudflare hasn’t yet seen its name servers at your domain’s registrar, so the records here aren’t live. Replace the registrar’s name servers with the ones below.'
	}
	if (current.status === 'initializing') return 'Cloudflare is still setting up this zone. Check again shortly.'
	if (current.status === 'moved') {
		return 'The name servers at your domain’s registrar no longer point to Cloudflare, so the records here aren’t live. Change them back to the ones below to keep this zone.'
	}
	return `Cloudflare reports this zone as ${current.status}.`
})

const setupLabel = computed(() => SETUP_LABELS[zone.value?.type]?.long || zone.value?.type || '')

const nameServers = computed(() => zone.value?.name_servers || [])
const showOriginalNameServers = computed(
	() =>
		zone.value?.status !== 'active' &&
		Boolean(zone.value?.original_name_servers?.length) &&
		Boolean(nameServers.value.length)
)

// Only reached once the feature check has answered; a failed check has its own alert.
const unavailableReason = (key) => {
	const reason = missingCapabilities.value.find((item) => item.key === key)?.reason
	return reason ? `Cloudflare said: ${reason}` : 'Cloudflare didn’t say why.'
}

const retryZone = () => refresh()

// SSL/TLS encryption mode
const currentSsl = computed(() => zone.value?.ssl?.value || '')
// zone.post.js reports "unknown" (with Cloudflare's reason) when the setting couldn't be read.
const sslReadError = computed(() =>
	currentSsl.value === 'unknown' ? zone.value?.ssl?.error || 'Cloudflare didn’t return the SSL setting.' : ''
)
const sslUnrecognised = computed(() => Boolean(currentSsl.value) && !(currentSsl.value in SSL_RANK))
const sslEditable = computed(() => zone.value?.ssl?.editable !== false)
const sslDraft = ref('')
const sslSaving = ref(false)
const sslConfirmOpen = ref(false)
const sslModalError = ref('')
const pendingSsl = ref('')

watch(
	[zoneId, currentSsl],
	() => {
		sslDraft.value = currentSsl.value in SSL_RANK ? currentSsl.value : ''
	},
	{ immediate: true }
)

const sslChanged = computed(() => Boolean(sslDraft.value) && sslDraft.value !== currentSsl.value)
const sslLabel = (value) => SSL_MODES.find((mode) => mode.value === value)?.label || value

const requestSslChange = () => {
	const target = sslDraft.value
	if (!sslChanged.value || sslSaving.value) return
	const lowering =
		SSL_RANK[target] <= SSL_RANK.flexible && SSL_RANK[target] < (SSL_RANK[currentSsl.value] ?? Infinity)
	if (lowering) {
		pendingSsl.value = target
		sslModalError.value = ''
		sslConfirmOpen.value = true
		return
	}
	saveSsl(target)
}

const saveSsl = async (target) => {
	const id = zoneId.value
	if (!id || !target) return
	sslSaving.value = true
	sslModalError.value = ''
	try {
		await call('update_ssl', { currZone: id, ssl: target }, { fallback: 'Cloudflare rejected the change' })
		sslConfirmOpen.value = false
		notifySuccess('Encryption mode updated', `${zoneName.value || 'This zone'} now uses ${sslLabel(target)}.`)
		await refresh()
	} catch (err) {
		if (sslConfirmOpen.value) sslModalError.value = describeError(err, 'Cloudflare rejected the change')
		else notifyError('Couldn’t change the encryption mode', err, 'Cloudflare rejected the change')
	} finally {
		sslSaving.value = false
	}
}

// Bot Fight Mode
const botEnabled = ref(false)
const botLoaded = ref(false)
const botLoading = ref(false)
const botSaving = ref(false)
const botError = ref('')
const botUnsupported = ref(false)

// Cloudflare documents a boolean, but older configurations have returned "on"/"off".
const readFightMode = (config) => {
	const value = config?.fight_mode
	if (typeof value === 'boolean') return value
	if (value === 'on' || value === 'true') return true
	if (value === 'off' || value === 'false') return false
	return null
}

const resetBot = () => {
	botEnabled.value = false
	botLoaded.value = false
	botLoading.value = false
	botSaving.value = false
	botError.value = ''
	botUnsupported.value = false
}

const loadBot = async ({ fresh = false } = {}) => {
	const id = zoneId.value
	if (!id || !can('botFightMode')) return
	botLoading.value = true
	botError.value = ''
	try {
		const response = await call(
			'bot_management',
			{ currZone: id, fresh },
			{ fallback: 'Cloudflare rejected the request' }
		)
		if (id !== zoneId.value) return
		const enabled = readFightMode(response?.result)
		botUnsupported.value = enabled === null
		botLoaded.value = enabled !== null
		if (enabled !== null) botEnabled.value = enabled
	} catch (err) {
		if (id === zoneId.value) botError.value = describeError(err, 'Cloudflare rejected the request')
	} finally {
		if (id === zoneId.value) botLoading.value = false
	}
}

watch(
	[zoneId, () => capabilitiesLoaded.value && can('botFightMode')],
	([id, allowed], previous) => {
		if (!previous || previous[0] !== id) resetBot()
		if (id && allowed && !botLoaded.value && !botLoading.value) loadBot()
	},
	{ immediate: true }
)

// Optimistic: the switch moves at once and returns to its old position if Cloudflare refuses.
const setBotFightMode = async (value) => {
	const id = zoneId.value
	if (!id || botSaving.value) return
	const previous = botEnabled.value
	botEnabled.value = value
	botSaving.value = true
	try {
		const response = await call(
			'update_bot_fight_mode',
			{ currZone: id, fight_mode: value },
			{ fallback: 'Cloudflare rejected the change' }
		)
		if (id !== zoneId.value) return
		const confirmed = readFightMode(response?.result)
		if (confirmed !== null) botEnabled.value = confirmed
		notifySuccess(value ? 'Bot Fight Mode turned on' : 'Bot Fight Mode turned off', zoneName.value || undefined)
	} catch (err) {
		if (id !== zoneId.value) return
		botEnabled.value = previous
		notifyError('Couldn’t change Bot Fight Mode', err, 'Cloudflare rejected the change')
	} finally {
		if (id === zoneId.value) botSaving.value = false
	}
}

const refreshing = computed(() => loading.value || botLoading.value)

const refreshAll = async () => {
	await Promise.all([refresh(), can('botFightMode') ? loadBot({ fresh: true }) : null])
}

const relatedLinks = computed(() => {
	const name = zoneName.value
	const id = zoneId.value
	if (!name || !id) return []
	const links = [
		{
			label: `Look up ${name} on public resolvers`,
			to: { path: '/tools/dns-lookup', query: { name, type: 'ALL', zone: id } }
		}
	]
	// Checking NS at the apex shows whether resolvers have picked up Cloudflare's name servers.
	if (nameServers.value.length) {
		links.push({
			label: `Check that resolvers see Cloudflare’s name servers for ${name}`,
			to: { path: '/tools/propagation', query: { name, type: 'NS', expected: nameServers.value[0], zone: id } }
		})
	} else {
		links.push({
			label: `Check propagation of ${name}`,
			to: { path: '/tools/propagation', query: { name, type: 'A', zone: id } }
		})
	}
	const accountId = zone.value?.account?.id
	if (accountId) {
		links.push({
			label: `Open ${name} in the Cloudflare dashboard`,
			to: `https://dash.cloudflare.com/${accountId}/${name}`,
			target: '_blank'
		})
	}
	return links
})
</script>
