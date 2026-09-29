<template>
	<UDashboardPanel id="zone-dns-settings">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span>DNS settings</span>
					<span v-if="zoneName" class="text-muted hidden truncate font-normal sm:inline">
						· {{ zoneName }}
					</span>
				</template>

				<template #right>
					<UTooltip v-if="canUse" text="Refresh from Cloudflare">
						<UButton
							icon="i-lucide-refresh-cw"
							color="neutral"
							variant="ghost"
							:loading="loading"
							:disabled="saving"
							:aria-label="zoneName ? `Refresh DNS settings for ${zoneName}` : 'Refresh DNS settings'"
							@click="refreshSettings"
						/>
					</UTooltip>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="mx-auto flex w-full max-w-3xl flex-col gap-10">
				<ZoneAccessNote
					v-if="zoneAccess.shared"
					:access="zoneAccess"
					area="dns"
					subject="these settings"
					class="-mb-6"
				/>
				<AccountFeatureGate
					:loaded="capabilitiesLoaded"
					:available="canUse"
					feature="DNS settings"
					:reason="accessReason"
					hint="The token needs the Zone DNS Settings or DNS permission for this zone: Read to show these settings, Edit to change them."
					:checking="zoneLoading"
					@retry="refreshZone"
				>
					<p class="text-muted text-sm">
						These settings apply to {{ zoneName || 'this zone' }} only.
						<ULink
							:to="{ path: '/console', query: { command: 'dns settings account edit' } }"
							class="text-primary focus-visible:outline-primary rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
							>Account defaults for new zones are in the Console</ULink
						>.
					</p>

					<UAlert
						v-if="loadError"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						:title="settings ? 'Couldn’t load the latest DNS settings' : 'Couldn’t load the DNS settings'"
						:description="loadError"
						:actions="[
							{
								label: 'Try again',
								icon: 'i-lucide-refresh-cw',
								color: 'neutral',
								variant: 'outline',
								loading,
								onClick: refreshSettings
							}
						]"
					/>

					<div v-if="!settings && !loadError" class="flex flex-col gap-10" aria-busy="true">
						<span class="sr-only" role="status">Loading DNS settings…</span>
						<div v-for="n in 3" :key="n" class="flex flex-col gap-3">
							<USkeleton class="h-5 w-40" />
							<USkeleton class="h-20 w-full" />
						</div>
					</div>

					<form
						v-else-if="settings"
						ref="formRoot"
						class="flex flex-col gap-10"
						novalidate
						@submit.prevent="submit"
					>
						<section aria-labelledby="cname-heading" class="flex flex-col gap-3">
							<h2 id="cname-heading" class="text-highlighted text-base font-semibold">
								CNAME flattening
							</h2>
							<USwitch
								v-model="form.flatten_all_cnames"
								:disabled="saving || !canEdit"
								label="Flatten all CNAME records"
								description="Cloudflare answers queries for every CNAME record in the zone with the addresses it points to, instead of the CNAME. A CNAME at the zone apex is always flattened, because of DNS limitations."
								:ui="{ root: 'border-default rounded-md border p-3', label: 'sr-only' }"
							/>
						</section>

						<section aria-labelledby="multi-provider-heading" class="flex flex-col gap-3">
							<h2 id="multi-provider-heading" class="text-highlighted text-base font-semibold">
								Multi-provider DNS
							</h2>
							<USwitch
								v-model="form.multi_provider"
								:disabled="saving || !canEdit"
								label="Multi-provider DNS"
								description="Cloudflare activates the zone even when NS records for other providers exist, and respects NS records at the zone apex during outbound zone transfers."
								:ui="{ root: 'border-default rounded-md border p-3', label: 'sr-only' }"
							/>
						</section>

						<section aria-labelledby="ns-heading" class="flex flex-col gap-4">
							<div class="flex flex-col gap-1">
								<h2 id="ns-heading" class="text-highlighted text-base font-semibold">Name servers</h2>
								<p class="text-muted text-sm">
									If a change gives the zone different name servers, update them at your domain’s
									registrar too.
									<ULink
										:to="`/zones/${zoneId}`"
										class="text-primary focus-visible:outline-primary rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
										>Overview lists the current ones</ULink
									>.
								</p>
							</div>

							<UFormField
								label="Name server type"
								description="Which name servers Cloudflare serves this zone from."
								:error="fieldErrors.nameservers_type || false"
							>
								<USelect
									v-model="form.nameservers_type"
									:items="nameserverItems"
									:disabled="saving || !canEdit"
									placeholder="Choose a type"
									class="w-full sm:w-80"
								/>
							</UFormField>

							<UFormField
								v-if="showNsSet"
								label="Name server set"
								:description="`The number of the configured name server set to use for this zone, from ${formatRange(NS_SET_RANGE)}.`"
								:error="fieldErrors.ns_set || false"
							>
								<UInputNumber
									v-model="form.ns_set"
									:min="NS_SET_RANGE.min"
									:max="NS_SET_RANGE.max"
									:step-snapping="false"
									:disabled="saving || !canEdit"
									placeholder="Not set"
									class="w-full sm:w-48"
								/>
							</UFormField>

							<UFormField
								:label="NUMBER_FIELDS.ns_ttl.label"
								:description="numberDescription('ns_ttl')"
								:help="durationHint('ns_ttl')"
								:error="fieldErrors.ns_ttl || false"
							>
								<UInputNumber
									v-model="form.ns_ttl"
									:min="NUMBER_FIELDS.ns_ttl.min"
									:max="NUMBER_FIELDS.ns_ttl.max"
									:step-snapping="false"
									:disabled="saving || !canEdit"
									placeholder="Not set"
									class="w-full sm:w-48"
								/>
							</UFormField>
						</section>

						<section aria-labelledby="soa-heading" class="flex flex-col gap-4">
							<div class="flex flex-col gap-1">
								<h2 id="soa-heading" class="text-highlighted text-base font-semibold">SOA record</h2>
								<p class="text-muted text-sm">
									The start of authority record Cloudflare serves for this zone. The timers mostly
									matter to secondary servers that transfer the zone from Cloudflare.
								</p>
							</div>

							<UFormField
								label="Primary name server"
								description="The primary name server, which may be used for outbound zone transfers. Leave empty to use the one Cloudflare assigns."
								:error="fieldErrors.soa_mname || false"
							>
								<UInput
									v-model="form.soa_mname"
									:disabled="saving || !canEdit"
									placeholder="Assigned by Cloudflare"
									autocomplete="off"
									spellcheck="false"
									class="w-full"
									:ui="{ base: 'font-mono' }"
								/>
							</UFormField>

							<UFormField
								label="Administrator email"
								description="The zone administrator’s email address written as a DNS name, with a dot in place of the @, as in admin.example.com."
								:error="fieldErrors.soa_rname || false"
							>
								<UInput
									v-model="form.soa_rname"
									:disabled="saving || !canEdit"
									placeholder="admin.example.com"
									autocomplete="off"
									spellcheck="false"
									class="w-full"
									:ui="{ base: 'font-mono' }"
								/>
							</UFormField>

							<div class="grid gap-4 sm:grid-cols-2">
								<UFormField
									v-for="key in SOA_NUMBER_KEYS"
									:key="key"
									:label="NUMBER_FIELDS[key].label"
									:description="numberDescription(key)"
									:help="durationHint(key)"
									:error="fieldErrors[key] || false"
								>
									<UInputNumber
										v-model="form[key]"
										:min="NUMBER_FIELDS[key].min"
										:max="NUMBER_FIELDS[key].max"
										:step-snapping="false"
										:disabled="saving || !canEdit"
										placeholder="Not set"
										class="w-full"
									/>
								</UFormField>
							</div>
						</section>

						<section aria-labelledby="zone-mode-heading" class="flex flex-col gap-3">
							<div class="flex flex-col gap-1">
								<h2 id="zone-mode-heading" class="text-highlighted text-base font-semibold">
									Zone mode
								</h2>
								<p class="text-muted text-sm">
									Whether this is a regular zone or a CDN-only or DNS-only one. Saving a different
									mode asks you to confirm first.
								</p>
							</div>
							<URadioGroup
								v-model="form.zone_mode"
								:items="zoneModeItems"
								variant="table"
								legend="Zone mode"
								:disabled="saving || !canEdit"
								:ui="{ legend: 'sr-only' }"
							>
								<template #label="{ item }">
									<span class="flex flex-wrap items-center gap-2">
										{{ item.label }}
										<UBadge
											v-if="item.value === baselineValues.zone_mode"
											color="neutral"
											variant="outline"
											size="sm"
											label="Current"
										/>
									</span>
								</template>
							</URadioGroup>
						</section>

						<section aria-labelledby="secondary-heading" class="flex flex-col gap-3">
							<h2 id="secondary-heading" class="text-highlighted text-base font-semibold">
								Secondary overrides
							</h2>
							<USwitch
								v-model="form.secondary_overrides"
								:disabled="saving || !canEdit"
								label="Secondary overrides"
								:ui="{ root: 'border-default rounded-md border p-3', label: 'sr-only' }"
							>
								<template #description>
									Lets a secondary DNS zone use proxied override records and CNAME flattening at the
									zone apex. It only matters for secondary zones.
									<template v-if="zoneType && zoneType !== 'secondary'">
										{{ zoneName || 'This zone' }} isn’t one, so it doesn’t affect it.
									</template>
								</template>
							</USwitch>
						</section>

						<section v-if="referenceZoneId" aria-labelledby="internal-heading" class="flex flex-col gap-3">
							<div class="flex flex-col gap-1">
								<h2 id="internal-heading" class="text-highlighted text-base font-semibold">
									Internal DNS
								</h2>
								<p class="text-muted text-sm">
									When this internal zone has no answer for a query, Cloudflare falls back to the
									reference zone.
								</p>
							</div>
							<dl class="divide-default border-default divide-y border-y text-sm">
								<div :class="rowClass">
									<dt class="text-muted">Reference zone</dt>
									<dd class="flex min-w-0 flex-col gap-0.5">
										<span v-if="referenceZoneName" class="text-default break-all">
											{{ referenceZoneName }}
										</span>
										<span class="flex min-w-0 items-center gap-1">
											<code class="text-muted font-mono break-all">{{ referenceZoneId }}</code>
											<UButton
												icon="i-lucide-copy"
												size="xs"
												color="neutral"
												variant="ghost"
												:aria-label="`Copy the reference zone ID for ${zoneName || 'this zone'}`"
												@click="copy(referenceZoneId, 'Zone ID')"
											/>
										</span>
									</dd>
								</div>
							</dl>
						</section>

						<AccountJsonPanel
							v-if="canEdit"
							:key="jsonPanelKey"
							:value="desired"
							label="Edit as JSON"
							editable
							apply-label="Apply to form"
							help="Applying replaces the form with this JSON. Saving sends only the settings that differ from Cloudflare’s, and the whole soa or nameservers object if any part of it changed."
							@apply="applyJson"
							@dirty="onJsonDirty"
						/>

						<div
							v-if="canEdit"
							class="bg-default border-default sticky bottom-0 z-10 flex flex-col gap-3 border-t py-3"
						>
							<UAlert
								v-if="saveError"
								role="alert"
								color="error"
								variant="subtle"
								icon="i-lucide-circle-alert"
								:title="
									saveError === JSON_UNAPPLIED
										? 'Your JSON edits haven’t been applied'
										: 'Cloudflare didn’t save the DNS settings'
								"
								:description="saveError"
							/>
							<div class="flex flex-wrap items-center justify-between gap-3">
								<p class="text-muted text-sm" aria-live="polite">
									{{ dirty ? 'You have unsaved changes.' : 'No unsaved changes.' }}
								</p>
								<div class="flex flex-wrap gap-2">
									<UButton
										label="Discard changes"
										color="neutral"
										variant="ghost"
										:disabled="!dirty || saving"
										@click="discardChanges"
									/>
									<UButton
										type="submit"
										label="Save DNS settings"
										:loading="saving && !zoneModeOpen"
										:disabled="!dirty || (saving && zoneModeOpen)"
									/>
								</div>
							</div>
						</div>
					</form>
				</AccountFeatureGate>
			</div>

			<UModal
				v-model:open="zoneModeOpen"
				:title="`Change the zone mode to ${zoneModeLabel(pendingChanges?.zone_mode)}?`"
				:dismissible="!saving"
				:close="!saving"
			>
				<template #body>
					<div class="flex flex-col gap-3 text-sm">
						<p class="text-default">
							The zone mode applies to all of
							<span class="text-highlighted font-medium">{{ zoneName || 'this zone' }}</span
							>, changing it from {{ zoneModeLabel(baselineValues.zone_mode) }} to
							{{ zoneModeLabel(pendingChanges?.zone_mode) }}.
						</p>
						<p class="text-default">{{ zoneModeDescription(pendingChanges?.zone_mode) }}</p>
						<p v-if="Object.keys(pendingChanges || {}).length > 1" class="text-muted">
							Your other changes are saved at the same time.
						</p>
						<UAlert
							v-if="zoneModeError"
							role="alert"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							title="Cloudflare didn’t save the DNS settings"
							:description="zoneModeError"
						/>
					</div>
				</template>
				<template #footer>
					<div class="flex w-full flex-wrap justify-end gap-2">
						<UButton
							label="Keep current mode"
							color="neutral"
							variant="ghost"
							:disabled="saving || !canEdit"
							@click="zoneModeOpen = false"
						/>
						<UButton
							label="Change zone mode"
							color="error"
							:loading="saving"
							@click="save(pendingChanges)"
						/>
					</div>
				</template>
			</UModal>

			<UModal
				:open="discardOpen"
				title="Discard unsaved changes?"
				:description="`The changes you made to the DNS settings for ${zoneName || 'this zone'} haven’t been saved.`"
				@update:open="(value) => value || answerDiscard(false)"
			>
				<template #footer>
					<div class="flex w-full justify-end gap-2">
						<UButton label="Keep editing" color="neutral" variant="outline" @click="answerDiscard(false)" />
						<UButton label="Discard changes" color="error" @click="answerDiscard(true)" />
					</div>
				</template>
			</UModal>
		</template>
	</UDashboardPanel>
</template>

<script setup>
import { useEventListener } from '@vueuse/core'

// The zone types `dns settings account edit` accepts for a zone (cf's flag lists the account's).
const NAMESERVER_TYPES = [
	{ value: 'cloudflare.standard', label: 'Cloudflare standard' },
	{ value: 'cloudflare.advanced', label: 'Cloudflare advanced' },
	{ value: 'custom.account', label: 'Account custom name servers' },
	{ value: 'custom.tenant', label: 'Tenant custom name servers' },
	{ value: 'custom.zone', label: 'Zone custom name servers' }
]

// Cloudflare only describes the modes as regular, CDN only and DNS only (no HTTP proxying).
const ZONE_MODES = [
	{
		value: 'standard',
		label: 'Standard',
		description: 'A regular zone: Cloudflare answers DNS queries and can proxy records.'
	},
	{
		value: 'cdn_only',
		label: 'CDN only',
		description:
			'Cloudflare’s API calls this a CDN-only zone and doesn’t document it further. Check with Cloudflare before choosing it.'
	},
	{
		value: 'dns_only',
		label: 'DNS only',
		description: 'No HTTP proxying, so proxied records don’t get Cloudflare’s security or performance features.'
	}
]

// Cloudflare's limits for each number, from its API reference.
const NUMBER_FIELDS = {
	ns_ttl: {
		label: 'NS record TTL (seconds)',
		description: 'How long resolvers can cache the zone’s NS records.',
		min: 30,
		max: 86_400
	},
	soa_refresh: {
		label: 'Refresh (seconds)',
		description: 'How long secondary servers wait before checking the SOA record again for updates.',
		min: 600,
		max: 86_400
	},
	soa_retry: {
		label: 'Retry (seconds)',
		description: 'How long secondary servers wait to try again after the primary server didn’t respond.',
		min: 600,
		max: 86_400
	},
	soa_expire: {
		label: 'Expire (seconds)',
		description: 'How long secondary servers keep serving the zone while they can’t reach the primary server.',
		min: 86_400,
		max: 2_419_200
	},
	soa_min_ttl: {
		label: 'Negative caching TTL (seconds)',
		description: 'How long resolvers cache answers saying a record in the zone doesn’t exist.',
		min: 60,
		max: 86_400
	},
	soa_ttl: {
		label: 'SOA record TTL (seconds)',
		description: 'How long resolvers can cache the SOA record itself.',
		min: 300,
		max: 86_400
	}
}
const NS_SET_RANGE = { min: 1, max: 5 }

const SOA_NUMBERS = ['refresh', 'retry', 'expire', 'min_ttl', 'ttl']
const SOA_NUMBER_KEYS = SOA_NUMBERS.map((field) => `soa_${field}`)
const BOOLEAN_FIELDS = ['flatten_all_cnames', 'multi_provider', 'secondary_overrides']
// Deprecated in favour of nameservers.type, so it's neither shown nor sent.
const OMITTED_FIELDS = ['foundation_dns']

const defaultForm = () => ({
	flatten_all_cnames: false,
	multi_provider: false,
	secondary_overrides: false,
	nameservers_type: '',
	ns_set: null,
	ns_ttl: null,
	soa_mname: '',
	soa_rname: '',
	soa_refresh: null,
	soa_retry: null,
	soa_expire: null,
	soa_min_ttl: null,
	soa_ttl: null,
	zone_mode: ''
})

const JSON_UNAPPLIED = 'Apply them to the form or discard them, then save again.'
const rowClass = 'grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6'

const route = useRoute()
const { exec } = useCfCommands()
const { copy, success: notifySuccess } = useNotify()
const { formatTtl } = useRecordTypes()
const { findZone } = useZones()

const {
	zoneId,
	zone,
	zoneName,
	loading: zoneLoading,
	capabilitiesLoaded,
	missingCapabilities,
	can,
	load: loadZone,
	refresh: refreshZone,
	access: zoneAccess,
	allowed
} = useZone(() => route.params.zone_id)

const canUse = computed(() => can('dnsSettings'))
// On a zone shared with this account, whether its DNS level lets the person change these.
const canEdit = computed(() => allowed('dns', 'edit'))
const accessReason = computed(() => missingCapabilities.value.find((item) => item.key === 'dnsSettings')?.reason || '')
const zoneType = computed(() => zone.value?.type || '')

useSeoMeta({ title: () => (zoneName.value ? `DNS settings · ${zoneName.value}` : 'DNS settings') })

watch(
	zoneId,
	(id) => {
		if (id) loadZone()
	},
	{ immediate: true }
)

// --- Mapping between Cloudflare's shape and the form -------------------------------------

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const toNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const toText = (value) => (typeof value === 'string' ? value : '')

// Splits a settings object into form values and the fields the form doesn't show.
const splitSettings = (source) => {
	const values = defaultForm()
	const rest = {}
	for (const [key, value] of Object.entries(isObject(source) ? source : {})) {
		if (OMITTED_FIELDS.includes(key) || value === undefined) continue
		if (BOOLEAN_FIELDS.includes(key)) {
			values[key] = value === true
		} else if (key === 'ns_ttl') {
			values.ns_ttl = toNumber(value)
		} else if (key === 'zone_mode') {
			values.zone_mode = toText(value)
		} else if (key === 'nameservers' && isObject(value)) {
			values.nameservers_type = toText(value.type)
			values.ns_set = toNumber(value.ns_set)
		} else if (key === 'soa' && isObject(value)) {
			values.soa_mname = toText(value.mname)
			values.soa_rname = toText(value.rname)
			for (const field of SOA_NUMBERS) values[`soa_${field}`] = toNumber(value[field])
		} else {
			rest[key] = value
		}
	}
	return { values, rest }
}

// The settings the form describes, in Cloudflare's zone shape. Empty values are left out,
// except mname, which Cloudflare takes as null to mean its own assigned name server.
const toSettings = (values) => {
	const settings = Object.fromEntries(BOOLEAN_FIELDS.map((key) => [key, values[key] === true]))
	const nsTtl = toNumber(values.ns_ttl)
	if (nsTtl !== null) settings.ns_ttl = nsTtl
	if (values.nameservers_type) {
		settings.nameservers = { type: values.nameservers_type }
		const nsSet = toNumber(values.ns_set)
		if (nsSet !== null) settings.nameservers.ns_set = nsSet
	}
	const soa = { mname: values.soa_mname.trim() || null }
	if (values.soa_rname.trim()) soa.rname = values.soa_rname.trim()
	for (const field of SOA_NUMBERS) {
		const number = toNumber(values[`soa_${field}`])
		if (number !== null) soa[field] = number
	}
	settings.soa = soa
	if (values.zone_mode) settings.zone_mode = values.zone_mode
	return settings
}

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// --- Loading -----------------------------------------------------------------------------

// Cloudflare's settings for the zone, as last read or saved.
const settings = ref(null)
const loading = ref(false)
const loadError = ref('')
let loadSeq = 0

const form = reactive(defaultForm())
// Fields that came from Cloudflare or the JSON editor but have no control in the form.
const extraFields = ref({})
const fieldErrors = reactive({})
const saveError = ref('')
const saving = ref(false)
const jsonDirty = ref(false)
// Remounts the JSON editor, dropping its unapplied edits, when the form is reset.
const jsonPanelKey = ref(0)

const formRoot = useTemplateRef('formRoot')

const resetErrors = () => {
	for (const key of Object.keys(fieldErrors)) fieldErrors[key] = ''
	saveError.value = ''
}

const resetForm = () => {
	const { values, rest } = splitSettings(settings.value)
	Object.assign(form, values)
	extraFields.value = rest
	jsonDirty.value = false
	jsonPanelKey.value++
	resetErrors()
}

const loadSettings = async () => {
	const id = zoneId.value
	if (!id || !canUse.value) return
	const seq = ++loadSeq
	loading.value = true
	loadError.value = ''
	const fallback = 'Cloudflare didn’t return the DNS settings'
	try {
		const response = await exec('dns settings account get', { zone: id, target: 'zone' }, { fallback })
		if (seq !== loadSeq) return
		settings.value = isObject(response?.result) ? response.result : {}
		resetForm()
	} catch (error) {
		if (seq === loadSeq) loadError.value = describeError(error, fallback)
	} finally {
		if (seq === loadSeq) loading.value = false
	}
}

// --- Form state --------------------------------------------------------------------------

const baselineValues = computed(() => splitSettings(settings.value).values)
const baseline = computed(() => ({ ...splitSettings(settings.value).rest, ...toSettings(baselineValues.value) }))
const desired = computed(() => ({ ...extraFields.value, ...toSettings(form) }))

// Cloudflare's update is a PATCH, so only settings that differ are sent. soa and nameservers
// go as whole objects, so a changed part never leaves the rest to Cloudflare's defaults.
const changedFields = () =>
	Object.fromEntries(Object.entries(desired.value).filter(([key, value]) => !sameValue(value, baseline.value[key])))

const dirty = computed(() => Boolean(settings.value) && (jsonDirty.value || Object.keys(changedFields()).length > 0))

const fieldChanged = (key) => {
	const value = typeof form[key] === 'string' ? form[key].trim() : form[key]
	const stored = baselineValues.value[key]
	return !sameValue(value === '' ? null : value, stored === '' ? null : stored)
}

const onJsonDirty = (value) => {
	jsonDirty.value = value
	if (!value && saveError.value === JSON_UNAPPLIED) saveError.value = ''
}

const applyJson = (parsed) => {
	const { values, rest } = splitSettings(parsed)
	Object.assign(form, values)
	extraFields.value = rest
	resetErrors()
}

const discardChanges = () => {
	if (saving.value) return
	resetForm()
}

const nameserverItems = computed(() => {
	const items = NAMESERVER_TYPES.map((item) => ({ ...item, description: item.value }))
	for (const value of [baselineValues.value.nameservers_type, form.nameservers_type]) {
		if (value && !items.some((item) => item.value === value)) items.push({ value, label: value })
	}
	return items
})

const showNsSet = computed(
	() => form.nameservers_type.startsWith('custom.') || baselineValues.value.ns_set !== null || form.ns_set !== null
)

const zoneModeItems = computed(() => {
	const items = [...ZONE_MODES]
	for (const value of [baselineValues.value.zone_mode, form.zone_mode]) {
		if (value && !items.some((item) => item.value === value)) {
			items.push({
				value,
				label: value,
				description: 'Cloudflare reports this mode, which this page doesn’t recognise.'
			})
		}
	}
	return items
})

const zoneModeLabel = (value) => ZONE_MODES.find((mode) => mode.value === value)?.label || value || 'not set'
const zoneModeDescription = (value) => ZONE_MODES.find((mode) => mode.value === value)?.description || ''

const referenceZoneId = computed(() => {
	const internal = extraFields.value.internal_dns ?? settings.value?.internal_dns
	return isObject(internal) ? toText(internal.reference_zone_id) : ''
})
const referenceZoneName = computed(() => (referenceZoneId.value ? findZone(referenceZoneId.value)?.name || '' : ''))

// --- Validation --------------------------------------------------------------------------

const formatRange = ({ min, max }) => `${min.toLocaleString()} to ${max.toLocaleString()}`

const numberDescription = (key) => `${NUMBER_FIELDS[key].description} ${formatRange(NUMBER_FIELDS[key])}.`

const durationHint = (key) => {
	const value = toNumber(form[key])
	return value !== null && value >= 60 ? formatTtl(value, { style: 'long' }) : undefined
}

// Only fields that differ from Cloudflare's are checked, so a stored value this page wouldn't
// accept never blocks saving something else.
const validate = () => {
	resetErrors()

	for (const [key, field] of Object.entries(NUMBER_FIELDS)) {
		if (!fieldChanged(key)) continue
		const value = toNumber(form[key])
		if (value === null || !Number.isInteger(value) || value < field.min || value > field.max) {
			fieldErrors[key] = `Enter a whole number from ${formatRange(field)}`
		}
	}

	if (fieldChanged('ns_set') && form.ns_set !== null) {
		const value = toNumber(form.ns_set)
		if (value === null || !Number.isInteger(value) || value < NS_SET_RANGE.min || value > NS_SET_RANGE.max) {
			fieldErrors.ns_set = `Enter a whole number from ${formatRange(NS_SET_RANGE)}`
		}
	}

	if (fieldChanged('nameservers_type') && !form.nameservers_type) {
		fieldErrors.nameservers_type = 'Choose a name server type'
	}

	const mname = form.soa_mname.trim()
	if (fieldChanged('soa_mname') && mname && !isHostname(mname)) {
		fieldErrors.soa_mname = 'Enter a host name, such as ns1.example.com, or leave it empty'
	}

	const rname = form.soa_rname.trim()
	if (fieldChanged('soa_rname')) {
		if (!rname) fieldErrors.soa_rname = 'Enter the administrator’s email as a DNS name, such as admin.example.com'
		else if (rname.includes('@')) {
			fieldErrors.soa_rname = `Replace the @ with a dot, as in ${rname.replace('@', '.')}`
		} else if (!isHostname(rname)) {
			fieldErrors.soa_rname = 'Enter the email as a DNS name, such as admin.example.com'
		}
	}

	return !Object.values(fieldErrors).some(Boolean)
}

const focusFirstError = async () => {
	await nextTick()
	const invalid = formRoot.value?.querySelector('[aria-invalid="true"]')
	const target = invalid?.matches('input, textarea, button')
		? invalid
		: invalid?.querySelector('input, textarea, button')
	target?.focus()
}

// --- Saving ------------------------------------------------------------------------------

const zoneModeOpen = ref(false)
const zoneModeError = ref('')
// The changes waiting for the zone mode to be confirmed.
const pendingChanges = ref(null)

const submit = () => {
	if (saving.value) return
	if (jsonDirty.value) {
		saveError.value = JSON_UNAPPLIED
		return
	}
	if (!validate()) {
		focusFirstError()
		return
	}
	const changes = changedFields()
	if (!Object.keys(changes).length) {
		notifySuccess('No changes to save', zoneName.value || undefined)
		return
	}
	if ('zone_mode' in changes) {
		pendingChanges.value = changes
		zoneModeError.value = ''
		zoneModeOpen.value = true
		return
	}
	save(changes)
}

const save = async (changes) => {
	const id = zoneId.value
	if (!id || !changes || saving.value) return
	saving.value = true
	saveError.value = ''
	zoneModeError.value = ''
	const fallback = 'Cloudflare didn’t save the DNS settings'
	try {
		const response = await exec(
			'dns settings account edit',
			{ zone: id, target: 'zone', body: changes },
			{ fallback }
		)
		if (id !== zoneId.value) return
		zoneModeOpen.value = false
		notifySuccess('DNS settings saved', zoneName.value || undefined)
		if (isObject(response?.result)) {
			loadSeq++
			loading.value = false
			loadError.value = ''
			settings.value = response.result
			resetForm()
		} else {
			await loadSettings()
		}
	} catch (error) {
		if (id !== zoneId.value) return
		const message = describeError(error, fallback)
		if (zoneModeOpen.value) zoneModeError.value = message
		else saveError.value = message
	} finally {
		if (id === zoneId.value) saving.value = false
	}
}

// --- Unsaved changes ---------------------------------------------------------------------

const discardOpen = ref(false)
let resolveDiscard = null

const answerDiscard = (discard) => {
	discardOpen.value = false
	resolveDiscard?.(discard)
	resolveDiscard = null
}

// Resolves true when there is nothing to lose or the person chooses to discard.
const confirmDiscard = () => {
	if (!dirty.value) return Promise.resolve(true)
	resolveDiscard?.(false)
	discardOpen.value = true
	return new Promise((resolve) => {
		resolveDiscard = resolve
	})
}

// A save in flight can't be discarded: it would still land in Cloudflare.
onBeforeRouteLeave(() => (saving.value ? false : confirmDiscard()))
// Switching zones keeps this page, so it's a route update rather than a leave.
onBeforeRouteUpdate((to, from) => {
	if (to.params.zone_id === from.params.zone_id) return true
	return saving.value ? false : confirmDiscard()
})

useEventListener(window, 'beforeunload', (event) => {
	if (dirty.value) event.preventDefault()
})

onBeforeUnmount(() => answerDiscard(false))

const refreshSettings = async () => {
	if (saving.value) return
	if (!(await confirmDiscard())) return
	await loadSettings()
}

// --- Zone changes ------------------------------------------------------------------------

const resetAll = () => {
	loadSeq++
	settings.value = null
	loading.value = false
	loadError.value = ''
	saving.value = false
	zoneModeOpen.value = false
	zoneModeError.value = ''
	pendingChanges.value = null
	answerDiscard(false)
	Object.assign(form, defaultForm())
	extraFields.value = {}
	jsonDirty.value = false
	jsonPanelKey.value++
	resetErrors()
}

watch(
	[zoneId, canUse],
	([id, allowed], previous) => {
		if (!previous || previous[0] !== id) resetAll()
		if (id && allowed && !settings.value && !loading.value) loadSettings()
	},
	{ immediate: true }
)
</script>
