<template>
	<UDashboardPanel id="zone-dnssec">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span>DNSSEC</span>
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
							:loading="refreshing"
							:aria-label="zoneName ? `Refresh DNSSEC for ${zoneName}` : 'Refresh DNSSEC'"
							@click="refreshAll"
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
					subject="DNSSEC"
					class="-mb-6"
				/>
				<AccountFeatureGate
					:loaded="capabilitiesLoaded"
					:available="canUse"
					feature="DNSSEC"
					:reason="accessReason"
					hint="The token needs the Zone DNS Read permission for this zone to show DNSSEC, and DNS Edit to change it."
					:checking="zoneLoading"
					@retry="refreshZone"
				>
					<p class="text-muted text-sm">
						DNSSEC signs the DNS answers for {{ zoneName || 'this zone' }} so resolvers can check they
						haven’t been tampered with. It only takes effect once the zone’s DS record is at your domain’s
						registrar.
					</p>

					<UAlert
						v-if="loadError"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						:title="dnssec ? 'Couldn’t load the latest DNSSEC details' : 'Couldn’t load DNSSEC'"
						:description="loadError"
						:actions="[
							{
								label: 'Try again',
								icon: 'i-lucide-refresh-cw',
								color: 'neutral',
								variant: 'outline',
								loading,
								onClick: loadDnssec
							}
						]"
					/>

					<div v-if="!dnssec && !loadError" class="flex flex-col gap-10" aria-busy="true">
						<span class="sr-only" role="status">Loading DNSSEC…</span>
						<div v-for="n in 2" :key="n" class="flex flex-col gap-3">
							<USkeleton class="h-5 w-40" />
							<USkeleton class="h-28 w-full" />
						</div>
					</div>

					<template v-else-if="dnssec">
						<section aria-labelledby="dnssec-status-heading" class="flex flex-col gap-3">
							<h2 id="dnssec-status-heading" class="text-highlighted text-base font-semibold">Status</h2>
							<dl class="divide-default border-default divide-y border-y text-sm">
								<div :class="rowClass">
									<dt class="text-muted">DNSSEC</dt>
									<dd class="flex min-w-0 flex-col gap-1.5">
										<div>
											<UBadge
												:color="statusBadge.color"
												variant="subtle"
												:label="statusBadge.label"
											/>
										</div>
										<p class="text-muted">{{ statusExplanation }}</p>
									</dd>
								</div>
								<div v-if="formatDate(dnssec.modified_on)" :class="rowClass">
									<dt class="text-muted">Last changed</dt>
									<dd class="text-default">
										<time :datetime="dnssec.modified_on">{{
											formatDate(dnssec.modified_on, 'datetime')
										}}</time>
									</dd>
								</div>
							</dl>
							<div v-if="canTurnOn || canTurnOff" class="flex flex-wrap justify-end gap-2">
								<UButton
									v-if="canTurnOn"
									:label="status === 'pending-disabled' ? 'Turn DNSSEC back on' : 'Turn on DNSSEC'"
									icon="i-lucide-shield-check"
									:loading="statusSaving"
									:disabled="Boolean(advancedSaving)"
									@click="setStatus('active')"
								/>
								<UButton
									v-else
									label="Turn off DNSSEC"
									color="neutral"
									variant="outline"
									:loading="statusSaving"
									:disabled="Boolean(advancedSaving)"
									@click="askTurnOff"
								/>
							</div>
						</section>

						<section
							v-if="hasDsDetails || isOn"
							aria-labelledby="dnssec-ds-heading"
							class="flex flex-col gap-3"
						>
							<div class="flex flex-col gap-1">
								<h2 id="dnssec-ds-heading" class="text-highlighted text-base font-semibold">
									DS record for your registrar
								</h2>
								<p v-if="hasDsDetails" class="text-muted text-sm">{{ dsIntro }}</p>
							</div>

							<p v-if="!hasDsDetails" class="text-muted text-sm">
								Cloudflare didn’t return a DS record for {{ zoneName || 'this zone' }}. Refresh to check
								again.
							</p>

							<template v-else>
								<dl
									v-if="dsRows.length"
									class="divide-default border-default divide-y border-y text-sm"
									aria-label="DS record"
								>
									<div v-for="row in dsRows" :key="row.key" :class="rowClass">
										<dt class="text-muted">{{ row.label }}</dt>
										<dd class="flex min-w-0 items-start gap-1">
											<span class="flex min-w-0 flex-col gap-0.5">
												<code class="text-highlighted font-mono break-all">{{
													row.value
												}}</code>
												<span v-if="row.note" class="text-muted">{{ row.note }}</span>
											</span>
											<UButton
												icon="i-lucide-copy"
												size="xs"
												color="neutral"
												variant="ghost"
												class="shrink-0"
												:aria-label="`Copy ${row.copyLabel} for ${zoneName || 'this zone'}`"
												@click="copy(row.value, row.label)"
											/>
										</dd>
									</div>
								</dl>

								<div v-if="dnskeyRows.length" class="flex flex-col gap-3 pt-3">
									<div class="flex flex-col gap-1">
										<h3 class="text-highlighted text-sm font-medium">
											If your registrar asks for DNSKEY
										</h3>
										<p class="text-muted text-sm">
											Some registrars ask for the zone’s public key instead of the DS record.
										</p>
									</div>
									<dl
										class="divide-default border-default divide-y border-y text-sm"
										aria-label="DNSKEY details"
									>
										<div v-for="row in dnskeyRows" :key="row.key" :class="rowClass">
											<dt class="text-muted">{{ row.label }}</dt>
											<dd class="flex min-w-0 items-start gap-1">
												<span class="flex min-w-0 flex-col gap-0.5">
													<code class="text-highlighted font-mono break-all">{{
														row.value
													}}</code>
													<span v-if="row.note" class="text-muted">{{ row.note }}</span>
												</span>
												<UButton
													icon="i-lucide-copy"
													size="xs"
													color="neutral"
													variant="ghost"
													class="shrink-0"
													:aria-label="`Copy DNSKEY ${row.copyLabel} for ${zoneName || 'this zone'}`"
													@click="copy(row.value, row.label)"
												/>
											</dd>
										</div>
									</dl>
								</div>
							</template>
						</section>

						<UCollapsible v-model:open="advancedOpen" class="flex flex-col">
							<UButton
								label="Advanced settings"
								color="neutral"
								variant="link"
								trailing-icon="i-lucide-chevron-down"
								class="group text-highlighted self-start px-0 text-base font-semibold"
								:ui="{
									trailingIcon: 'transition-transform duration-200 group-data-[state=open]:rotate-180'
								}"
							/>

							<template #content>
								<div class="flex flex-col gap-3 pt-3">
									<p class="text-muted text-sm">
										Each setting saves as soon as you change it. Most zones don’t need these.
									</p>
									<USwitch
										v-for="setting in ADVANCED_SETTINGS"
										:key="setting.key"
										:model-value="dnssec[setting.key] === true"
										:loading="advancedSaving === setting.key"
										:disabled="Boolean(advancedSaving) || statusSaving || !canEdit"
										:label="setting.label"
										:ui="{ root: 'border-default rounded-md border p-3' }"
										@update:model-value="(value) => setAdvanced(setting, value)"
									>
										<template #description>
											{{ setting.description }}
											<ULink
												:to="setting.docs"
												target="_blank"
												class="text-primary focus-visible:outline-primary rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
												>Cloudflare’s guide<span class="sr-only">
													to {{ setting.label }} (opens in a new tab)</span
												></ULink
											>
										</template>
									</USwitch>
								</div>
							</template>
						</UCollapsible>

						<UCollapsible v-model:open="zsksOpen" class="flex flex-col">
							<UButton
								label="Zone signing keys"
								color="neutral"
								variant="link"
								trailing-icon="i-lucide-chevron-down"
								class="group text-highlighted self-start px-0 text-base font-semibold"
								:ui="{
									trailingIcon: 'transition-transform duration-200 group-data-[state=open]:rotate-180'
								}"
							/>

							<template #content>
								<div class="flex flex-col gap-3 pt-3">
									<p class="text-muted text-sm">
										The keys Cloudflare uses to sign this zone’s records. Cloudflare manages them,
										so there’s nothing to do here.
									</p>
									<AccountResourceTable
										:data="zsks"
										:columns="ZSK_COLUMNS"
										:loading="zsksLoading"
										:loaded="zsksLoaded"
										:error="zsksError"
										error-title="Couldn’t load the zone signing keys"
										caption="Zone signing keys"
										loading-label="Loading zone signing keys…"
										@retry="loadZsks"
									>
										<template #empty>
											<UEmpty
												variant="naked"
												icon="i-lucide-key-round"
												title="No zone signing keys"
												:description="`Cloudflare didn’t return any zone signing keys for ${zoneName || 'this zone'}.`"
											/>
										</template>

										<template #name-cell="{ row }">
											<span
												class="text-highlighted block max-w-[45vw] truncate font-mono text-xs sm:max-w-64"
												:title="row.original.Name"
											>
												{{ row.original.Name || 'Unnamed key' }}
											</span>
										</template>

										<template #state-cell="{ row }">
											<UBadge
												:color="zskState(row.original).color"
												variant="subtle"
												:label="zskState(row.original).label"
											/>
										</template>

										<template #algorithm-cell="{ row }">
											<span v-if="hasValue(row.original.DNSKEY?.Algorithm)">
												{{ row.original.DNSKEY.Algorithm }}
											</span>
											<span v-else class="text-dimmed">Unknown</span>
										</template>

										<template #ttl-cell="{ row }">
											<span v-if="formatTtl(row.original.DNSKEY?.Hdr?.Ttl)">
												{{ formatTtl(row.original.DNSKEY.Hdr.Ttl) }}
											</span>
											<span v-else class="text-dimmed">Unknown</span>
										</template>

										<template #location-cell="{ row }">
											<span v-if="row.original.Location">
												{{ LOCATION_LABELS[row.original.Location] || row.original.Location }}
											</span>
											<span v-else class="text-dimmed">Unknown</span>
										</template>

										<template #actions-cell="{ row }">
											<div class="flex justify-end">
												<UButton
													v-if="row.original.DNSKEY?.PublicKey"
													icon="i-lucide-copy"
													size="xs"
													color="neutral"
													variant="ghost"
													:aria-label="`Copy the public key of ${row.original.Name || 'this key'}`"
													@click="copy(row.original.DNSKEY.PublicKey, 'Public key')"
												/>
											</div>
										</template>
									</AccountResourceTable>
								</div>
							</template>
						</UCollapsible>

						<section
							v-if="canDelete && status && status !== 'disabled'"
							aria-labelledby="dnssec-delete-heading"
							class="flex flex-col gap-3"
						>
							<div class="flex flex-col gap-1">
								<h2 id="dnssec-delete-heading" class="text-highlighted text-base font-semibold">
									Delete DNSSEC records
								</h2>
								<p class="text-muted text-sm">
									Deletes the DNSSEC records for {{ zoneName || 'this zone' }} at Cloudflare. Remove
									the DS record at your domain’s registrar first.
									<template v-if="isOn"
										>To stop using DNSSEC, turning it off above is enough.</template
									>
								</p>
							</div>
							<UButton
								label="Delete DNSSEC records"
								icon="i-lucide-trash-2"
								color="error"
								variant="outline"
								class="self-start"
								:disabled="statusSaving || Boolean(advancedSaving)"
								@click="deleteOpen = true"
							/>
						</section>

						<section
							v-if="relatedLinks.length"
							aria-labelledby="dnssec-related-heading"
							class="flex flex-col gap-3"
						>
							<h2 id="dnssec-related-heading" class="text-highlighted text-base font-semibold">
								Related tools
							</h2>
							<ul class="flex flex-col gap-2 text-sm">
								<li v-for="link in relatedLinks" :key="link.label">
									<ULink
										raw
										:to="link.to"
										:target="link.target"
										class="text-primary focus-visible:outline-primary inline-flex items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
									>
										{{ link.label }}
										<UIcon
											v-if="link.target"
											name="i-lucide-external-link"
											class="size-3.5 shrink-0"
										/>
										<span v-if="link.target" class="sr-only">(opens in a new tab)</span>
									</ULink>
								</li>
							</ul>
						</section>
					</template>
				</AccountFeatureGate>
			</div>

			<UModal
				v-model:open="turnOffOpen"
				:title="zoneName ? `Turn off DNSSEC for ${zoneName}?` : 'Turn off DNSSEC?'"
				:dismissible="!statusSaving"
				:close="!statusSaving"
			>
				<template #body>
					<div class="flex flex-col gap-3 text-sm">
						<p class="text-default">
							Remove the DS record for
							<span class="text-highlighted font-medium">{{ zoneName || 'this zone' }}</span> at your
							domain’s registrar first. If resolvers that validate DNSSEC still find it once Cloudflare
							stops signing the zone, they can’t resolve the domain, so people who use them can’t reach
							it.
						</p>
						<p v-if="status === 'pending'" class="text-muted">
							Cloudflare hasn’t found a DS record at the registrar yet. If you never added one, you can
							turn DNSSEC off now.
						</p>
						<UAlert
							v-if="turnOffError"
							role="alert"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							title="Cloudflare didn’t turn off DNSSEC"
							:description="turnOffError"
						/>
					</div>
				</template>
				<template #footer>
					<div class="flex w-full flex-wrap justify-end gap-2">
						<UButton
							label="Keep DNSSEC on"
							color="neutral"
							variant="ghost"
							:disabled="statusSaving"
							@click="turnOffOpen = false"
						/>
						<UButton
							label="Turn off DNSSEC"
							color="error"
							:loading="statusSaving"
							@click="setStatus('disabled')"
						/>
					</div>
				</template>
			</UModal>

			<AccountDeleteModal
				v-model:open="deleteOpen"
				:title="zoneName ? `Delete the DNSSEC records for ${zoneName}?` : 'Delete the DNSSEC records?'"
				description="If the DS record is still at your domain’s registrar, resolvers that validate DNSSEC can’t resolve the domain. This can’t be undone."
				confirm-label="Delete DNSSEC records"
				error-title="Cloudflare didn’t delete the DNSSEC records"
				:action="deleteDnssec"
			/>
		</template>
	</UDashboardPanel>
</template>

<script setup>
// Statuses where DNSSEC is meant to be on, so the page offers to turn it off; the others offer
// to turn it on.
const ON_STATUSES = new Set(['active', 'pending', 'error'])
const OFF_STATUSES = new Set(['disabled', 'pending-disabled'])

// Explanations are Cloudflare's own descriptions of each `dns dnssec edit` flag, shortened.
const ADVANCED_SETTINGS = [
	{
		key: 'dnssec_multi_signer',
		flag: 'dnssec-multi-signer',
		label: 'Multi-signer DNSSEC',
		description:
			'Lets more than one provider serve this zone signed with DNSSEC at the same time. Needed before you can add DNSKEY records other than the ones Cloudflare creates.',
		docs: 'https://developers.cloudflare.com/dns/dnssec/multi-signer-dnssec/'
	},
	{
		key: 'dnssec_presigned',
		flag: 'dnssec-presigned',
		label: 'Pre-signed DNSSEC',
		description:
			'For secondary zones: Cloudflare transfers in a zone already signed by an external provider, signatures included, without signing any records itself. This has some limitations.',
		docs: 'https://developers.cloudflare.com/dns/zone-setups/zone-transfers/cloudflare-as-secondary/setup/#dnssec'
	},
	{
		key: 'dnssec_use_nsec3',
		flag: 'dnssec-use-nsec3',
		label: 'NSEC3',
		description:
			'Uses NSEC3 records with DNSSEC. With pre-signed DNSSEC on, the NSEC3 records come from the external provider; otherwise Cloudflare creates and signs them as it answers.',
		docs: 'https://developers.cloudflare.com/dns/dnssec/enable-nsec3/'
	}
]

const ZSK_STATES = {
	active: { label: 'Active', color: 'success' },
	publish: { label: 'Published', color: 'info' },
	external: { label: 'External', color: 'neutral' },
	retired: { label: 'Retired', color: 'neutral' },
	revoked: { label: 'Revoked', color: 'error' },
	removed: { label: 'Removed', color: 'neutral' }
}
const LOCATION_LABELS = { database: 'Database', vault: 'Vault' }

const FROM_SM = { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' }
const FROM_MD = { th: 'hidden md:table-cell', td: 'hidden md:table-cell' }

// The private key material Cloudflare also returns for each key is never shown.
const ZSK_COLUMNS = [
	{ id: 'name', header: 'Name' },
	{ id: 'state', header: 'State' },
	{ id: 'algorithm', header: 'Algorithm', meta: { class: FROM_SM } },
	{ id: 'ttl', header: 'TTL', meta: { class: FROM_MD } },
	{ id: 'location', header: 'Stored in', meta: { class: FROM_MD } },
	{
		id: 'actions',
		header: () => h('span', { class: 'sr-only' }, 'Actions'),
		meta: { class: { td: 'w-px text-end' } }
	}
]

const rowClass = 'grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6'

const route = useRoute()
const { exec } = useCfCommands()
const { copy, success: notifySuccess, error: notifyError } = useNotify()
const { formatTtl } = useRecordTypes()

const {
	zoneId,
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

const canUse = computed(() => can('dnssec'))
// On a zone shared with this account, what its DNS level allows (own zones allow everything).
const canEdit = computed(() => allowed('dns', 'edit'))
const canDelete = computed(() => allowed('dns', 'delete'))
const accessReason = computed(() => missingCapabilities.value.find((item) => item.key === 'dnssec')?.reason || '')

useSeoMeta({ title: () => (zoneName.value ? `DNSSEC · ${zoneName.value}` : 'DNSSEC') })

watch(
	zoneId,
	(id) => {
		if (id) loadZone()
	},
	{ immediate: true }
)

const hasValue = (value) => value !== undefined && value !== null && value !== ''

// --- DNSSEC details ----------------------------------------------------------------------

const dnssec = ref(null)
const loading = ref(false)
const loadError = ref('')
// Bumped by every load, save and zone change, so only the newest answer lands.
let loadSeq = 0

const loadDnssec = async () => {
	const id = zoneId.value
	if (!id || !canUse.value) return
	const seq = ++loadSeq
	loading.value = true
	loadError.value = ''
	try {
		const response = await exec('dns dnssec get', { zone: id }, { fallback: 'Cloudflare didn’t return DNSSEC' })
		if (seq !== loadSeq) return
		dnssec.value = response?.result && typeof response.result === 'object' ? response.result : {}
	} catch (error) {
		if (seq === loadSeq) loadError.value = describeError(error, 'Cloudflare didn’t return DNSSEC')
	} finally {
		if (seq === loadSeq) loading.value = false
	}
}

// A change answers with the new details; use them rather than reading again.
const applyResult = (result) => {
	if (!result || typeof result !== 'object') return loadDnssec()
	loadSeq++
	loading.value = false
	loadError.value = ''
	dnssec.value = result
}

const status = computed(() => dnssec.value?.status || '')
const statusBadge = computed(() => dnssecStatusBadge(status.value))
const isOn = computed(() => ON_STATUSES.has(status.value))
const canTurnOn = computed(() => canEdit.value && OFF_STATUSES.has(status.value))
const canTurnOff = computed(() => canEdit.value && isOn.value)

const statusExplanation = computed(() => {
	const name = zoneName.value || 'this zone'
	switch (status.value) {
		case 'active':
			return `Cloudflare signs ${name} and has found its DS record at your domain’s registrar, so resolvers that validate DNSSEC can check its answers. Keep the DS record at the registrar while DNSSEC is on.`
		case 'pending':
			return `Cloudflare signs ${name} but hasn’t found its DS record at your domain’s registrar yet, so resolvers don’t check its answers. Add the DS record below at your registrar. The status changes to Active once Cloudflare finds it.`
		case 'disabled':
			return `Cloudflare doesn’t sign ${name}. Turning DNSSEC on gives you a DS record to add at your domain’s registrar. If the registrar still has a DS record for this domain, remove it: while it’s there, resolvers that validate DNSSEC can’t resolve the domain.`
		case 'pending-disabled':
			return `DNSSEC is being turned off for ${name}. Remove the DS record at your domain’s registrar if it’s still there. The status changes to Off once Cloudflare no longer finds it.`
		case 'error':
			return `Cloudflare reports a DNSSEC error for ${name}. Check that the DS record at your domain’s registrar matches the one below exactly, and replace it if it doesn’t.`
		default:
			return status.value
				? `Cloudflare reports DNSSEC as “${status.value}”.`
				: 'Cloudflare didn’t say whether DNSSEC is on for this zone.'
	}
})

// --- DS record ---------------------------------------------------------------------------

// Each field Cloudflare returned, as registrars ask for them. Empty fields are left out.
const dsRows = computed(() => {
	const details = dnssec.value || {}
	return [
		{ key: 'ds', label: 'DS record', copyLabel: 'the DS record', value: details.ds },
		{ key: 'key_tag', label: 'Key tag', copyLabel: 'the key tag', value: details.key_tag },
		{
			key: 'algorithm',
			label: 'Algorithm',
			copyLabel: 'the algorithm',
			value: details.algorithm,
			note: details.key_type
		},
		{
			key: 'digest_type',
			label: 'Digest type',
			copyLabel: 'the digest type',
			value: details.digest_type,
			note: details.digest_algorithm
		},
		{ key: 'digest', label: 'Digest', copyLabel: 'the digest', value: details.digest }
	].filter((row) => hasValue(row.value))
})

const dnskeyRows = computed(() => {
	const details = dnssec.value || {}
	if (!hasValue(details.flags) && !hasValue(details.public_key)) return []
	return [
		{ key: 'flags', label: 'Flags', copyLabel: 'flags', value: details.flags },
		{
			key: 'algorithm',
			label: 'Algorithm',
			copyLabel: 'algorithm',
			value: details.algorithm,
			note: details.key_type
		},
		{ key: 'public_key', label: 'Public key', copyLabel: 'public key', value: details.public_key }
	].filter((row) => hasValue(row.value))
})

const hasDsDetails = computed(() => dsRows.value.length > 0 || dnskeyRows.value.length > 0)

const dsIntro = computed(() => {
	if (status.value === 'pending') {
		return 'Add this at your domain’s registrar to finish turning on DNSSEC. Some registrars take the whole record; others ask for each part.'
	}
	if (status.value === 'pending-disabled' || status.value === 'disabled') {
		return 'If your domain’s registrar still has this DS record, remove it.'
	}
	return 'This should be at your domain’s registrar. Some registrars take the whole record; others ask for each part.'
})

// --- On and off --------------------------------------------------------------------------

const statusSaving = ref(false)
const turnOffOpen = ref(false)
const turnOffError = ref('')

const askTurnOff = () => {
	turnOffError.value = ''
	turnOffOpen.value = true
}

const setStatus = async (target) => {
	const id = zoneId.value
	if (!id || statusSaving.value) return
	statusSaving.value = true
	turnOffError.value = ''
	const fallback = 'Cloudflare didn’t change DNSSEC'
	try {
		const response = await exec('dns dnssec edit', { zone: id, flags: { status: target } }, { fallback })
		if (id !== zoneId.value) return
		turnOffOpen.value = false
		await applyResult(response?.result)
		if (zsksLoaded.value) loadZsks()
		const name = zoneName.value || undefined
		if (target === 'active') {
			notifySuccess(
				'DNSSEC turned on',
				status.value === 'active' ? name : 'Add the DS record at your domain’s registrar to finish.'
			)
		} else if (status.value === 'pending-disabled') {
			notifySuccess(
				'DNSSEC is turning off',
				'Remove the DS record at your domain’s registrar if it’s still there.'
			)
		} else {
			notifySuccess('DNSSEC turned off', name)
		}
	} catch (error) {
		if (id !== zoneId.value) return
		if (turnOffOpen.value) turnOffError.value = describeError(error, fallback)
		else notifyError(target === 'active' ? 'Couldn’t turn on DNSSEC' : 'Couldn’t turn off DNSSEC', error, fallback)
	} finally {
		if (id === zoneId.value) statusSaving.value = false
	}
}

// --- Advanced settings -------------------------------------------------------------------

const advancedOpen = ref(false)
// The key of the setting being saved. One at a time, so each answer describes one change.
const advancedSaving = ref('')

// Optimistic: the switch moves at once and returns to its old position if Cloudflare refuses.
const setAdvanced = async (setting, value) => {
	const id = zoneId.value
	if (!id || !dnssec.value || advancedSaving.value || statusSaving.value) return
	const previous = dnssec.value[setting.key]
	dnssec.value = { ...dnssec.value, [setting.key]: value }
	advancedSaving.value = setting.key
	const fallback = 'Cloudflare rejected the change'
	try {
		const response = await exec('dns dnssec edit', { zone: id, flags: { [setting.flag]: value } }, { fallback })
		if (id !== zoneId.value) return
		if (response?.result && typeof response.result === 'object') applyResult(response.result)
		notifySuccess(`${setting.label} turned ${value ? 'on' : 'off'}`, zoneName.value || undefined)
	} catch (error) {
		if (id !== zoneId.value) return
		if (dnssec.value) dnssec.value = { ...dnssec.value, [setting.key]: previous }
		notifyError(`Couldn’t change ${setting.label}`, error, fallback)
	} finally {
		if (id === zoneId.value) advancedSaving.value = ''
	}
}

// --- Zone signing keys -------------------------------------------------------------------

const zsksOpen = ref(false)
const zsks = ref([])
const zsksLoaded = ref(false)
const zsksLoading = ref(false)
const zsksError = ref('')
let zskSeq = 0

const resetZsks = () => {
	zskSeq++
	zsks.value = []
	zsksLoaded.value = false
	zsksLoading.value = false
	zsksError.value = ''
}

const loadZsks = async () => {
	const id = zoneId.value
	if (!id || !canUse.value) return
	const seq = ++zskSeq
	zsksLoading.value = true
	zsksError.value = ''
	try {
		const response = await exec(
			'dns dnssec list zsks',
			{ zone: id },
			{ fallback: 'Cloudflare didn’t return the zone signing keys' }
		)
		if (seq !== zskSeq) return
		zsks.value = Array.isArray(response?.result) ? response.result : []
		zsksLoaded.value = true
	} catch (error) {
		if (seq === zskSeq) zsksError.value = describeError(error, 'Cloudflare didn’t return the zone signing keys')
	} finally {
		if (seq === zskSeq) zsksLoading.value = false
	}
}

const zskState = (key) => ZSK_STATES[key?.Tag] || { label: key?.Tag || 'Unknown', color: 'neutral' }

// Loaded the first time the section opens, since most visits don't need the keys.
watch(zsksOpen, (open) => {
	if (open && !zsksLoaded.value && !zsksLoading.value) loadZsks()
})

// --- Delete ------------------------------------------------------------------------------

const deleteOpen = ref(false)

// Throws to keep the modal open with Cloudflare's message.
const deleteDnssec = async () => {
	const id = zoneId.value
	if (!id) return
	await exec('dns dnssec delete', { zone: id }, { fallback: 'Cloudflare didn’t delete the DNSSEC records' })
	if (id !== zoneId.value) return
	notifySuccess('DNSSEC records deleted', zoneName.value || undefined)
	resetZsks()
	if (zsksOpen.value) loadZsks()
	await loadDnssec()
}

// --- Zone changes and refresh ------------------------------------------------------------

const resetAll = () => {
	loadSeq++
	dnssec.value = null
	loading.value = false
	loadError.value = ''
	statusSaving.value = false
	advancedSaving.value = ''
	turnOffOpen.value = false
	turnOffError.value = ''
	deleteOpen.value = false
	resetZsks()
}

watch(
	[zoneId, canUse],
	([id, allowed], previous) => {
		if (!previous || previous[0] !== id) resetAll()
		if (!id || !allowed) return
		if (!dnssec.value && !loading.value) loadDnssec()
		if (zsksOpen.value && !zsksLoaded.value && !zsksLoading.value) loadZsks()
	},
	{ immediate: true }
)

const refreshing = computed(() => loading.value || zsksLoading.value)

const refreshAll = async () => {
	await Promise.all([loadDnssec(), zsksOpen.value || zsksLoaded.value ? loadZsks() : null])
}

const relatedLinks = computed(() => {
	const name = zoneName.value
	const id = zoneId.value
	if (!name || !id) return []
	return [
		{
			label: `Look up the DS record for ${name} on public resolvers`,
			to: { path: '/tools/dns-lookup', query: { name, type: 'DS', zone: id } }
		},
		{
			label: 'Open “dns dnssec get” in the Console',
			to: { path: '/console', query: { command: 'dns dnssec get', zone: id } }
		},
		{
			label: 'Cloudflare’s DNSSEC documentation',
			to: 'https://developers.cloudflare.com/dns/dnssec/',
			target: '_blank'
		}
	]
})
</script>
