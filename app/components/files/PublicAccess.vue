<template>
	<section aria-labelledby="files-public-heading" class="border-default flex flex-col border-t pt-4">
		<h2 id="files-public-heading">
			<UButton
				color="neutral"
				variant="link"
				trailing-icon="i-lucide-chevron-down"
				class="group px-0"
				:aria-expanded="open"
				:ui="{
					trailingIcon: `transition-transform duration-200 ${open ? 'rotate-180' : ''}`
				}"
				@click="open = !open"
			>
				<span class="text-highlighted text-base font-semibold">Public access</span>
				<UBadge :color="summary.color" variant="subtle" size="sm">{{ summary.label }}</UBadge>
			</UButton>
		</h2>

		<UCollapsible v-model:open="open">
			<template #content>
				<div class="flex flex-col gap-8 pt-3">
					<p class="text-muted text-sm">
						Files in <code class="text-default font-mono">{{ bucket }}</code> are private until you turn on
						a public address. Then anyone with a file’s link can read it, though visitors can’t list the
						bucket.
						<ULink
							raw
							:to="PUBLIC_DOCS_URL"
							target="_blank"
							class="text-primary focus-visible:outline-primary rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
							>About public buckets</ULink
						>
					</p>

					<div class="flex flex-col gap-3">
						<h3 class="text-highlighted text-sm font-semibold">r2.dev address</h3>

						<div v-if="managed.status === 'idle' || managed.status === 'loading'" aria-busy="true">
							<span class="sr-only" role="status">Checking the r2.dev address…</span>
							<USkeleton class="h-16 w-full" />
						</div>

						<UAlert
							v-else-if="managed.status === 'error'"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							role="alert"
							title="Couldn’t check the r2.dev address"
							:description="managed.error"
							:actions="[
								{
									label: 'Try again',
									icon: 'i-lucide-refresh-cw',
									color: 'neutral',
									variant: 'outline',
									loading: managed.loading,
									onClick: loadManaged
								}
							]"
						/>

						<template v-else>
							<USwitch
								:model-value="managedOn"
								:disabled="!editable"
								label="Public r2.dev address"
								:description="managedDescription"
								:ui="{ root: 'border-default rounded-md border p-3' }"
								@update:model-value="askManaged"
							/>
							<div v-if="managedOn && managedUrl" class="flex min-w-0 items-center gap-1">
								<code class="text-default truncate font-mono text-xs">{{ managedUrl }}</code>
								<UButton
									icon="i-lucide-copy"
									size="xs"
									color="neutral"
									variant="ghost"
									aria-label="Copy the r2.dev address"
									@click="notify.copy(managedUrl, 'Address')"
								/>
							</div>
						</template>
					</div>

					<div class="flex flex-col gap-3">
						<div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
							<div class="flex min-w-0 flex-col gap-1">
								<h3 class="text-highlighted text-sm font-semibold">Custom domains</h3>
								<p class="text-muted text-sm">
									Serve the files from a subdomain of {{ zoneName }}, such as files.{{ zoneName }}.
									Cloudflare adds the DNS record for it to the zone.
								</p>
							</div>
							<UButton
								v-if="editable"
								label="Connect a domain"
								icon="i-lucide-plus"
								size="sm"
								color="neutral"
								variant="outline"
								:disabled="custom.status !== 'ready'"
								@click="openConnect"
							/>
						</div>

						<div
							v-if="custom.status === 'idle' || custom.status === 'loading'"
							class="flex flex-col gap-2"
							aria-busy="true"
						>
							<span class="sr-only" role="status">Loading custom domains…</span>
							<USkeleton v-for="line in 2" :key="line" class="h-10 w-full" />
						</div>

						<UAlert
							v-else-if="custom.status === 'error'"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							role="alert"
							title="Couldn’t load the custom domains"
							:description="custom.error"
							:actions="[
								{
									label: 'Try again',
									icon: 'i-lucide-refresh-cw',
									color: 'neutral',
									variant: 'outline',
									loading: custom.loading,
									onClick: loadCustom
								}
							]"
						/>

						<p v-else-if="!custom.list.length" class="text-muted border-default border-y py-3 text-sm">
							No custom domains are connected to {{ bucket }}.
						</p>

						<ul v-else class="divide-default border-default divide-y border-y" aria-label="Custom domains">
							<li
								v-for="domain in custom.list"
								:key="domain.domain"
								class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
							>
								<div class="flex min-w-0 flex-1 flex-col gap-0.5">
									<span class="text-highlighted truncate font-mono text-sm">{{ domain.domain }}</span>
									<span class="text-muted text-xs">{{ domainDetail(domain) }}</span>
								</div>
								<UBadge :color="domainState(domain).color" variant="subtle" size="sm">
									{{ domainState(domain).label }}
								</UBadge>
								<div class="flex items-center">
									<UButton
										icon="i-lucide-copy"
										size="xs"
										color="neutral"
										variant="ghost"
										:aria-label="`Copy the address https://${domain.domain}`"
										@click="notify.copy(`https://${domain.domain}`, 'Address')"
									/>
									<UButton
										v-if="removable"
										icon="i-lucide-trash-2"
										size="xs"
										color="error"
										variant="ghost"
										:aria-label="`Remove ${domain.domain}`"
										@click="askRemove(domain)"
									/>
								</div>
							</li>
						</ul>
					</div>
				</div>
			</template>
		</UCollapsible>

		<RegistrarConfirmModal
			v-model:open="managedConfirmOpen"
			:title="managedTarget ? `Make ${bucket} public at r2.dev?` : `Turn off the r2.dev address for ${bucket}?`"
			:description="
				managedTarget
					? `Anyone with the link can read every file in ${bucket}, including files you upload later. Cloudflare rate-limits r2.dev addresses and says they’re for development only; use a custom domain for anything else.`
					: `Links to files at ${managedUrl || 'the r2.dev address'} stop working. Custom domains keep working.`
			"
			:confirm-label="managedTarget ? 'Turn on r2.dev address' : 'Turn off r2.dev address'"
			:confirm-icon="managedTarget ? 'i-lucide-globe' : undefined"
			:confirm-color="managedTarget ? 'warning' : 'primary'"
			:error-title="
				managedTarget ? 'Cloudflare didn’t turn on the address' : 'Cloudflare didn’t turn off the address'
			"
			:action="setManaged"
		/>

		<UModal
			v-model:open="connectOpen"
			:title="`Connect a domain to ${bucket}`"
			:description="`Cloudflare adds the DNS record for the subdomain to ${zoneName} and sets up its certificate. It takes a few minutes to become active.`"
			:dismissible="!connecting"
			:close="{ disabled: connecting }"
		>
			<template #body>
				<form :id="connectFormId" class="flex flex-col gap-4" novalidate @submit.prevent="connect">
					<UFormField
						label="Subdomain"
						name="files-custom-domain"
						required
						:description="fullDomain ? `The address will be https://${fullDomain}` : ''"
						:error="domainError || false"
					>
						<UFieldGroup class="w-full">
							<UInput
								v-model="domainLabel"
								placeholder="files"
								autocomplete="off"
								spellcheck="false"
								autocapitalize="off"
								class="min-w-0 flex-1"
								:ui="{ base: 'font-mono' }"
								@update:model-value="domainError = ''"
							/>
							<UBadge
								color="neutral"
								variant="outline"
								size="lg"
								class="max-w-1/2 truncate font-mono"
								:label="`.${zoneName}`"
							/>
						</UFieldGroup>
					</UFormField>

					<UAlert
						color="warning"
						variant="subtle"
						icon="i-lucide-triangle-alert"
						title="This makes the bucket public"
						:description="`Once the domain is active, anyone with the link can read every file in ${bucket} at this address, including files you upload later.`"
					/>

					<UAlert
						v-if="connectError"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						role="alert"
						title="Cloudflare didn’t connect the domain"
						:description="connectError"
					/>
				</form>
			</template>

			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						label="Cancel"
						color="neutral"
						variant="ghost"
						:disabled="connecting"
						@click="connectOpen = false"
					/>
					<UButton
						type="submit"
						:form="connectFormId"
						:label="fullDomain ? `Connect ${fullDomain}` : 'Connect domain'"
						icon="i-lucide-globe"
						color="warning"
						:loading="connecting"
					/>
				</div>
			</template>
		</UModal>

		<AccountDeleteModal
			v-model:open="removeOpen"
			:title="removeTarget ? `Remove ${removeTarget.domain} from ${bucket}?` : 'Remove this domain?'"
			:description="`Links to files at ${removeTarget?.domain || 'this domain'} stop working. The files stay in ${bucket}.`"
			confirm-label="Remove domain"
			error-title="Cloudflare didn’t remove the domain"
			:action="removeDomain"
		/>
	</section>
</template>

<script setup>
// Public access to a zone's bucket: its r2.dev address and custom domains. Reports the address
// files can be read from through v-model:base ('' while the bucket is private), so the page can
// show each file's public link. The page keys it by zone, so its state never outlives a zone.
const PUBLIC_DOCS_URL = 'https://developers.cloudflare.com/r2/buckets/public-buckets/'
const PROBLEM_STATES = new Set(['error', 'blocked', 'deactivated'])

const props = defineProps({
	zoneId: { type: String, required: true },
	zoneName: { type: String, required: true },
	bucket: { type: String, required: true },
	// On a shared zone: whether its files level allows turning public access on or off and
	// connecting domains, and removing them
	editable: { type: Boolean, default: true },
	removable: { type: Boolean, default: true }
})

// https://<address> for public links, from an active custom domain or the r2.dev address
const base = defineModel('base', { type: String, default: '' })

const notify = useNotify()
const { exec } = useCfCommands()
const connectFormId = useId()

// Answers that arrive after the page has moved on are dropped.
let alive = true
onBeforeUnmount(() => {
	alive = false
})

const open = ref(false)
const managed = reactive({ status: 'idle', data: null, error: '', loading: false })
const custom = reactive({ status: 'idle', list: [], error: '', loading: false })
const requests = { managed: 0, custom: 0 }

const withZone = (input) => ({ accountOfZone: props.zoneId, ...input })

const loadManaged = async () => {
	const request = ++requests.managed
	const fallback = 'Couldn’t check the r2.dev address'
	managed.loading = true
	if (managed.status !== 'ready') managed.status = 'loading'
	try {
		const response = await exec(
			'r2 buckets domains managed list',
			withZone({ flags: { 'bucket-name': props.bucket } }),
			{ fallback }
		)
		if (!alive || request !== requests.managed) return
		Object.assign(managed, { status: 'ready', data: response?.result || null, error: '' })
	} catch (error) {
		if (!alive || request !== requests.managed) return
		Object.assign(managed, { status: 'error', data: null, error: describeError(error, fallback) })
	} finally {
		if (alive && request === requests.managed) managed.loading = false
	}
}

const loadCustom = async () => {
	const request = ++requests.custom
	const fallback = 'Couldn’t load the custom domains'
	custom.loading = true
	if (custom.status !== 'ready') custom.status = 'loading'
	try {
		const response = await exec(
			'r2 buckets domains custom list',
			withZone({ flags: { 'bucket-name': props.bucket } }),
			{ fallback }
		)
		if (!alive || request !== requests.custom) return
		const domains = Array.isArray(response?.result?.domains) ? response.result.domains : []
		Object.assign(custom, { status: 'ready', list: domains.filter((item) => item?.domain), error: '' })
	} catch (error) {
		if (!alive || request !== requests.custom) return
		Object.assign(custom, { status: 'error', list: [], error: describeError(error, fallback) })
	} finally {
		if (alive && request === requests.custom) custom.loading = false
	}
}

const refresh = () => Promise.all([loadManaged(), loadCustom()])

defineExpose({ refresh })

onMounted(refresh)

// --- Display -------------------------------------------------------------------------------

const managedOn = computed(() => managed.data?.enabled === true)
const managedUrl = computed(() => (managed.data?.domain ? `https://${managed.data.domain}` : ''))

const managedDescription = computed(() =>
	managedOn.value
		? `On. Anyone with the link can read files at ${managedUrl.value || 'the bucket’s r2.dev address'}. Cloudflare rate-limits r2.dev addresses and says they’re for development only.`
		: `Off. Turning it on gives ${props.bucket} an r2.dev address anyone can read files from. Cloudflare rate-limits these and says they’re for development only.`
)

const isActiveDomain = (domain) =>
	domain.enabled && domain.status?.ownership === 'active' && domain.status?.ssl === 'active'

watchEffect(() => {
	const domain = custom.list.find(isActiveDomain)
	const url = domain ? `https://${domain.domain}` : managedOn.value ? managedUrl.value : ''
	if (alive && base.value !== url) base.value = url
})

// Public as soon as either source says so; private only once both have answered.
const summary = computed(() => {
	if (managedOn.value || custom.list.some((domain) => domain.enabled)) return { label: 'Public', color: 'warning' }
	if (managed.status === 'ready' && custom.status === 'ready') return { label: 'Private', color: 'neutral' }
	if (managed.status === 'error' || custom.status === 'error') return { label: 'Unknown', color: 'neutral' }
	return { label: 'Checking…', color: 'neutral' }
})

const domainState = (domain) => {
	if (!domain.enabled) return { label: 'Off', color: 'neutral' }
	if (isActiveDomain(domain)) return { label: 'Active', color: 'success' }
	const { ownership, ssl } = domain.status || {}
	if (PROBLEM_STATES.has(ownership) || PROBLEM_STATES.has(ssl)) return { label: 'Needs attention', color: 'error' }
	return { label: 'Setting up', color: 'warning' }
}

const domainDetail = (domain) =>
	`Ownership ${domain.status?.ownership || 'unknown'} · certificate ${domain.status?.ssl || 'unknown'}`

// --- r2.dev address ----------------------------------------------------------------------

const managedConfirmOpen = ref(false)
const managedTarget = ref(false)

// The switch only moves once Cloudflare has made the change.
const askManaged = (value) => {
	managedTarget.value = value
	managedConfirmOpen.value = true
}

const setManaged = async () => {
	const enabled = managedTarget.value
	const response = await exec(
		'r2 buckets domains managed update',
		withZone({ args: { 'bucket-name': props.bucket }, flags: { enabled } }),
		{ fallback: enabled ? 'Cloudflare didn’t turn on the address' : 'Cloudflare didn’t turn off the address' }
	)
	if (!alive) return
	requests.managed += 1
	const result = response?.result && typeof response.result === 'object' ? response.result : {}
	Object.assign(managed, {
		status: 'ready',
		data: { ...managed.data, ...result, enabled: typeof result.enabled === 'boolean' ? result.enabled : enabled },
		error: '',
		loading: false
	})
	notify.success(enabled ? 'r2.dev address turned on' : 'r2.dev address turned off', props.bucket)
}

// --- Custom domains ------------------------------------------------------------------------

const connectOpen = ref(false)
const domainLabel = ref('')
const domainError = ref('')
const connectError = ref('')
const connecting = ref(false)

// Accepts the subdomain on its own or typed in full, such as files.example.com.
const subdomain = computed(() => {
	const zone = props.zoneName.toLowerCase()
	const text = domainLabel.value.trim().toLowerCase().replace(/\.+$/, '')
	if (text === zone) return ''
	return text.endsWith(`.${zone}`) ? text.slice(0, -zone.length - 1) : text
})
const fullDomain = computed(() => (subdomain.value ? `${subdomain.value}.${props.zoneName.toLowerCase()}` : ''))

const isConnected = (domain) => custom.list.some((item) => String(item.domain).toLowerCase() === domain)

const openConnect = () => {
	const suggested = `files.${props.zoneName.toLowerCase()}`
	domainLabel.value = isConnected(suggested) ? '' : 'files'
	domainError.value = ''
	connectError.value = ''
	connectOpen.value = true
}

const validateDomain = () => {
	if (!subdomain.value) return `Enter a subdomain of ${props.zoneName}, such as files`
	if (!isHostname(fullDomain.value, { allowUnderscore: false })) {
		return `“${subdomain.value}” can’t be used in a domain name. Use letters, digits, hyphens and dots.`
	}
	if (isConnected(fullDomain.value)) return `${fullDomain.value} is already connected to ${props.bucket}`
	return ''
}

const connect = async () => {
	if (connecting.value) return
	domainError.value = validateDomain()
	if (domainError.value) return
	const domain = fullDomain.value
	const fallback = 'Cloudflare didn’t connect the domain'
	connecting.value = true
	connectError.value = ''
	try {
		await exec(
			'r2 buckets domains custom create',
			withZone({
				args: { 'bucket-name': props.bucket },
				flags: { domain, 'zone-id': props.zoneId, enabled: true }
			}),
			{ fallback }
		)
		if (!alive) return
		connectOpen.value = false
		notify.success(
			`Connecting ${domain}`,
			'Cloudflare is adding its DNS record and certificate. It takes a few minutes to become active; refresh to check.'
		)
		loadCustom()
	} catch (error) {
		if (alive) connectError.value = describeError(error, fallback)
	} finally {
		if (alive) connecting.value = false
	}
}

const removeOpen = ref(false)
const removeTarget = ref(null)

const askRemove = (domain) => {
	removeTarget.value = domain
	removeOpen.value = true
}

const removeDomain = async () => {
	const domain = removeTarget.value?.domain
	if (!domain) return
	await exec(
		'r2 buckets domains custom delete',
		withZone({ args: { domain }, flags: { 'bucket-name': props.bucket } }),
		{ fallback: 'Cloudflare didn’t remove the domain' }
	)
	if (!alive) return
	requests.custom += 1
	custom.list = custom.list.filter((item) => item.domain !== domain)
	notify.success(`Removed ${domain}`, props.bucket)
}
</script>
