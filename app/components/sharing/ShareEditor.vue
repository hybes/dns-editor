<template>
	<AccountFormSlideover
		:open="open"
		:title="share ? `Edit what ${share.label} can do` : 'Share domains'"
		:description="
			inviteUrl
				? undefined
				: 'Pick the domains, what this person can do on them, and whether they see renewal prices.'
		"
		:submit-label="share ? 'Save changes' : 'Create invite link'"
		:saving="saving"
		:error="error"
		error-title="Couldn’t save the share"
		@update:open="(value) => emit('update:open', value)"
		@submit="save"
	>
		<template v-if="inviteUrl">
			<div class="flex flex-col gap-3">
				<p class="text-default text-sm text-pretty">
					Send this link to {{ form.label }}. It works once and for 7 days. They sign in, or create a DNS
					Manager account, and the domains appear in their list.
				</p>
				<div class="flex items-center gap-2">
					<UInput
						:model-value="inviteUrl"
						readonly
						class="min-w-0 flex-1 font-mono"
						aria-label="Invite link"
					/>
					<UButton
						icon="i-lucide-copy"
						label="Copy"
						color="neutral"
						variant="outline"
						@click="notify.copy(inviteUrl, 'Invite link')"
					/>
				</div>
			</div>
		</template>

		<template v-else>
			<UFormField label="Who is this for?" help="Only you see this name." :error="fieldErrors.label || undefined">
				<UInput v-model="form.label" placeholder="Adam" maxlength="60" class="w-full" autofocus />
			</UFormField>

			<UFormField label="Domains" :error="fieldErrors.zones || undefined">
				<USelectMenu
					v-model="form.zoneIds"
					:items="zoneItems"
					value-key="value"
					multiple
					:search-input="{ placeholder: 'Find a domain' }"
					:virtualize="zoneItems.length > 100"
					placeholder="Choose domains"
					icon="i-lucide-globe"
					class="w-full"
				/>
			</UFormField>

			<fieldset class="flex flex-col gap-3">
				<legend class="text-default mb-1 text-sm font-medium">What they can do</legend>
				<p class="text-muted -mt-1 text-sm">
					For every domain in this share, unless a domain says otherwise below.
				</p>
				<div v-for="area in AREAS" :key="area.key" class="flex items-center justify-between gap-3">
					<label :for="`share-default-${area.key}`" class="text-default text-sm">{{ area.label }}</label>
					<USelect
						:id="`share-default-${area.key}`"
						v-model="form.defaults[area.key]"
						:items="levelItems(area)"
						class="w-40 shrink-0"
					/>
				</div>
			</fieldset>

			<USwitch
				v-model="form.showPrices"
				label="Show renewal prices"
				description="With renewal access, they see Cloudflare’s renewal price, or the price you set for a domain below. A price you set shows even with this off."
				:ui="{ root: 'border-default rounded-md border p-3' }"
			/>

			<section v-if="form.zoneIds.length" aria-labelledby="share-domains-heading" class="flex flex-col gap-2">
				<h3 id="share-domains-heading" class="text-default text-sm font-medium">Per domain</h3>
				<p class="text-muted -mt-1 text-sm">
					Change what they can do on one domain, or set the price they see.
				</p>
				<ul class="divide-default border-default divide-y border-y">
					<li v-for="zoneId in form.zoneIds" :key="zoneId">
						<details class="group py-2.5">
							<summary class="flex cursor-pointer list-none items-center gap-2 text-sm">
								<UIcon
									name="i-lucide-chevron-right"
									class="text-dimmed size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
									aria-hidden="true"
								/>
								<span class="text-highlighted min-w-0 flex-1 truncate font-medium">{{
									zoneName(zoneId)
								}}</span>
								<span class="text-muted shrink-0 text-xs">{{ zoneSummary(zoneId) }}</span>
							</summary>
							<div class="mt-3 flex flex-col gap-3 ps-6">
								<div
									v-for="area in AREAS"
									:key="area.key"
									class="flex items-center justify-between gap-3"
								>
									<label :for="`share-${zoneId}-${area.key}`" class="text-muted text-sm">
										{{ area.label }}
									</label>
									<USelect
										:id="`share-${zoneId}-${area.key}`"
										:model-value="form.zones[zoneId].overrides[area.key] || DEFAULT"
										:items="overrideItems(area)"
										class="w-48 shrink-0"
										@update:model-value="(value) => setOverride(zoneId, area.key, value)"
									/>
								</div>
								<div class="flex flex-col gap-1">
									<div class="flex items-start gap-2">
										<UFormField label="Price they see" class="min-w-0 flex-1">
											<UInput
												v-model="form.zones[zoneId].amount"
												inputmode="decimal"
												placeholder="20.00"
												class="w-full"
											/>
										</UFormField>
										<UFormField label="Currency" class="w-28">
											<USelect
												v-model="form.zones[zoneId].currency"
												:items="CURRENCIES"
												class="w-full"
											/>
										</UFormField>
									</div>
									<p class="text-muted text-xs">
										A year, instead of Cloudflare’s. Leave it empty to use Cloudflare’s.
									</p>
								</div>
							</div>
						</details>
					</li>
				</ul>
			</section>
		</template>

		<template v-if="inviteUrl" #footer>
			<div class="flex w-full justify-end">
				<UButton label="Done" @click="emit('update:open', false)" />
			</div>
		</template>
	</AccountFormSlideover>
</template>

<script setup>
import { AREAS, DEFAULT_LEVELS, LEVEL_LABELS } from '#shared/utils/access'

// Creating or editing a share: the domains, a level per area for all of them, per-domain
// overrides and prices, and whether renewal prices show. A new share ends on its invite link,
// which is shown once; the sharing page can make a new one later.
const props = defineProps({
	open: { type: Boolean, default: false },
	// The share to edit, from /api/shares/list, or null for a new one
	share: { type: Object, default: null },
	// The account's own zones, which are the ones it can share
	zones: { type: Array, required: true }
})

const emit = defineEmits(['update:open', 'saved'])

const DEFAULT = 'default'
const CURRENCIES = ['GBP', 'USD', 'EUR', 'AUD', 'CAD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'JPY', 'INR']

const { call } = useCfApi()
const notify = useNotify()

const saving = ref(false)
const error = ref('')
const fieldErrors = reactive({ label: '', zones: '' })
const inviteUrl = ref('')

const blankZone = () => ({ overrides: {}, amount: '', currency: 'GBP' })
const form = reactive({ label: '', zoneIds: [], defaults: { ...DEFAULT_LEVELS }, showPrices: false, zones: {} })

// Fill the form each time the panel opens.
watch(
	() => props.open,
	(open) => {
		if (!open) return
		error.value = ''
		inviteUrl.value = ''
		Object.assign(fieldErrors, { label: '', zones: '' })
		const share = props.share
		form.label = share?.label || ''
		form.defaults = { ...DEFAULT_LEVELS, ...(share?.defaults || {}) }
		form.showPrices = Boolean(share?.showPrices)
		form.zoneIds = (share?.zones || []).map((zone) => zone.id)
		form.zones = Object.fromEntries(
			(share?.zones || []).map((zone) => [
				zone.id,
				{
					overrides: { ...zone.overrides },
					amount: zone.price?.amount || '',
					currency: zone.price?.currency || 'GBP'
				}
			])
		)
	},
	{ immediate: true }
)

// Every chosen domain has a row to hold its overrides and price.
watch(
	() => form.zoneIds,
	(ids) => {
		for (const id of ids) if (!form.zones[id]) form.zones[id] = blankZone()
	},
	{ deep: true }
)

const zoneItems = computed(() =>
	[...props.zones].sort((a, b) => a.name.localeCompare(b.name)).map((zone) => ({ label: zone.name, value: zone.id }))
)

// A shared domain the owner can no longer see still shows by its saved name.
const zoneName = (id) =>
	props.zones.find((zone) => zone.id === id)?.name || props.share?.zones?.find((zone) => zone.id === id)?.name || id

const levelItems = (area) => area.levels.map((level) => ({ label: LEVEL_LABELS[level], value: level }))
const overrideItems = (area) => [
	{ label: `Default (${LEVEL_LABELS[form.defaults[area.key]]})`, value: DEFAULT },
	...levelItems(area)
]

const setOverride = (zoneId, area, value) => {
	const rest = Object.fromEntries(Object.entries(form.zones[zoneId].overrides).filter(([key]) => key !== area))
	form.zones[zoneId].overrides = value === DEFAULT ? rest : { ...rest, [area]: value }
}

const zoneSummary = (zoneId) => {
	const zone = form.zones[zoneId]
	if (!zone) return ''
	const parts = []
	const changed = Object.keys(zone.overrides).length
	if (changed) parts.push(`${plural(changed, 'change')} from default`)
	if (String(zone.amount).trim()) parts.push(`${zone.amount} ${zone.currency}`)
	return parts.join(' · ') || 'Default'
}

const save = async () => {
	Object.assign(fieldErrors, { label: '', zones: '' })
	error.value = ''
	if (!form.label.trim()) fieldErrors.label = 'Enter a name for the person you’re sharing with.'
	if (!form.zoneIds.length) fieldErrors.zones = 'Choose at least one domain.'
	if (fieldErrors.label || fieldErrors.zones) return
	saving.value = true
	try {
		const response = await call(
			'shares/save',
			{
				id: props.share?.id,
				label: form.label.trim(),
				defaults: form.defaults,
				showPrices: form.showPrices,
				zones: form.zoneIds.map((id) => {
					const zone = form.zones[id] || blankZone()
					const amount = String(zone.amount).trim()
					return { id, overrides: zone.overrides, price: amount ? { amount, currency: zone.currency } : null }
				})
			},
			{ fallback: 'Couldn’t save the share' }
		)
		emit('saved')
		const token = response?.result?.inviteToken
		if (token) inviteUrl.value = `${window.location.origin}/invite/${token}`
		else {
			notify.success('Share updated', form.label.trim())
			emit('update:open', false)
		}
	} catch (reason) {
		error.value = describeError(reason, 'Couldn’t save the share. Try again.')
	} finally {
		saving.value = false
	}
}
</script>
