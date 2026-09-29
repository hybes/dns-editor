<template>
	<UDashboardPanel id="usage">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span>Usage and billing</span>
					<span v-if="accountName" class="text-muted hidden truncate font-normal sm:inline">
						· {{ accountName }}
					</span>
				</template>

				<template #right>
					<UButton
						v-if="accountId"
						icon="i-lucide-external-link"
						label="Billing in Cloudflare"
						color="neutral"
						variant="ghost"
						class="hidden sm:inline-flex"
						:to="dashboardUrl"
						target="_blank"
					/>
					<UTooltip v-if="accountId" text="Refresh usage and billing">
						<UButton
							icon="i-lucide-refresh-cw"
							color="neutral"
							variant="ghost"
							aria-label="Refresh usage and billing"
							:loading="checking"
							@click="refreshKey++"
						/>
					</UTooltip>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<p class="text-muted max-w-3xl text-sm text-pretty">
				Metered usage, R2 storage, subscriptions and billing history for one Cloudflare account.
			</p>

			<UFormField
				label="Account"
				name="usage-account"
				class="sm:w-80"
				:description="accountsError ? `Couldn’t load your accounts: ${accountsError}` : ''"
			>
				<USelectMenu
					v-model="accountId"
					:items="accountItems"
					value-key="value"
					:loading="accountsLoading && !accountItems.length"
					:search-input="accountItems.length > 8 ? { placeholder: 'Find an account…' } : false"
					placeholder="Choose an account"
					icon="i-lucide-building-2"
					class="w-full"
				/>
			</UFormField>

			<UEmpty
				v-if="!accountId"
				variant="naked"
				icon="i-lucide-building-2"
				:title="accountsLoading ? 'Loading your accounts…' : 'Choose an account'"
				description="Usage and billing belong to a Cloudflare account. Choose one to see what it uses and pays for."
			/>

			<div v-else class="flex min-w-0 flex-col gap-10">
				<UsageAccessGuide
					v-if="missing.length"
					:missing="missing"
					:account="accountId"
					:everything="hidden('usage', 'r2', 'subscriptions', 'history')"
					:checking="checking"
					@check="refreshKey++"
				/>

				<div
					v-if="!hidden('usage', 'r2')"
					role="group"
					aria-labelledby="usage-period-label"
					class="flex flex-col gap-2"
				>
					<span id="usage-period-label" class="text-default text-sm font-medium">Period</span>
					<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
						<UFieldGroup size="sm" role="group" aria-label="Preset periods">
							<UButton
								v-for="option in PERIODS"
								:key="option.value"
								:label="option.label"
								:color="preset === option.value ? 'primary' : 'neutral'"
								:variant="preset === option.value ? 'subtle' : 'outline'"
								:aria-pressed="preset === option.value"
								@click="selectPreset(option.value)"
							/>
						</UFieldGroup>

						<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
							<div v-for="field in DATE_FIELDS" :key="field.key" class="flex items-center gap-2">
								<label :for="`usage-${field.key}`" class="text-muted w-10 text-sm sm:w-auto">{{
									field.label
								}}</label>
								<UInput
									:id="`usage-${field.key}`"
									type="date"
									size="sm"
									class="w-36"
									:model-value="field.key === 'from' ? fromDate : toDate"
									:min="field.key === 'to' ? fromDate || undefined : undefined"
									:max="field.key === 'from' ? toDate || todayUtc() : todayUtc()"
									:color="inputErrors[field.key] ? 'error' : undefined"
									:highlight="Boolean(inputErrors[field.key])"
									:aria-invalid="Boolean(inputErrors[field.key])"
									:aria-describedby="inputErrors[field.key] ? 'usage-period-error' : undefined"
									@update:model-value="(value) => onDateChange(field.key, value)"
								/>
							</div>
						</div>
					</div>
					<p v-if="dateError" id="usage-period-error" class="text-error text-xs" role="alert">
						{{ dateError }}
					</p>
					<p class="text-muted text-xs">
						Days are in UTC. Cloudflare reports billable usage and R2 for up to {{ MAX_DAYS }} days at a
						time.
					</p>
				</div>

				<UsageBillableUsage
					:account="accountId"
					:from="period.from"
					:to="period.to"
					:period-label="periodLabel"
					:refresh-key="refreshKey"
					:billing-readable="billingReadable"
					@access="(value) => (access.usage = value)"
				/>

				<UsageR2Storage
					:account="accountId"
					:from="period.from"
					:to="period.to"
					:period-label="periodLabel"
					:refresh-key="refreshKey"
					@access="(value) => (access.r2 = value)"
				/>

				<USeparator v-if="!hidden('usage', 'r2') && !hidden('subscriptions', 'history')" />

				<UsageSubscriptions
					:account="accountId"
					:refresh-key="refreshKey"
					@access="(value) => (access.subscriptions = value)"
				/>

				<UsageBillingHistory
					:account="accountId"
					:refresh-key="refreshKey"
					@access="(value) => (access.history = value)"
				/>
			</div>
		</template>
	</UDashboardPanel>
</template>

<script setup>
// Usage and billing for one account: metered usage and R2 storage for a period, then what the
// account is subscribed to and its billing history. Each section loads, fails and retries on its
// own. The account lives in the URL (/usage?account=<id>) and defaults to the account of the zone
// the sidebar last showed, as the Registrar page does.

const DAY_MS = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Both the billable usage API and R2's metrics answer for at most 31 days at a time.
const MAX_DAYS = 31
// Long enough that typing a date segment by segment sends one request, not one per key.
const INPUT_DEBOUNCE_MS = 600

const DATE_FIELDS = [
	{ key: 'from', label: 'From' },
	{ key: 'to', label: 'To' }
]

const PERIODS = [
	{ value: 'month', label: 'This month' },
	{ value: 'last-month', label: 'Last month' },
	{ value: '30d', label: 'Last 30 days' }
]

const route = useRoute()
const router = useRouter()
const { load: loadZones, findZone } = useZones()
const { accounts, loading: accountsLoading, error: accountsError, load: loadAccounts, findAccount } = useAccounts()

const queryValue = (value) => (typeof value === 'string' ? value : Array.isArray(value) ? value[0] || '' : '')

const accountId = ref(queryValue(route.query.account).trim())
const refreshKey = ref(0)

const accountName = computed(() => findAccount(accountId.value)?.name || '')

// What each section could read, as the sections report it: { loading, missing, readable, hidden }.
// Sections the token can't read hide themselves, and UsageAccessGuide says once what to add.
const access = reactive({})
const missing = computed(() => [...new Set(Object.values(access).flatMap((entry) => entry.missing))])
const hidden = (...sections) => sections.every((section) => access[section]?.hidden)
const checking = computed(() => Object.values(access).some((entry) => entry.loading))
// A refusal from the billable usage API isn't the token's fault if billing reads work elsewhere.
const billingReadable = computed(() => Boolean(access.subscriptions?.readable || access.history?.readable))

const accountItems = computed(() => {
	const items = accounts.value.map((account) => ({ label: account.name || account.id, value: account.id }))
	// An account from a link that the list doesn't include, so the picker still shows it.
	if (accountId.value && !items.some((item) => item.value === accountId.value)) {
		items.unshift({ label: accountId.value, value: accountId.value })
	}
	return items
})

const dashboardUrl = computed(() => `https://dash.cloudflare.com/${encodeURIComponent(accountId.value)}/billing`)

useSeoMeta({
	title: computed(() => (accountName.value ? `Usage and billing · ${accountName.value}` : 'Usage and billing'))
})

// As the console does: the account of the zone the sidebar last showed, or the token's only one.
const defaultAccount = () => {
	const fromZone = findZone(readStorage(STORAGE_KEYS.zoneId))?.account?.id
	if (fromZone && accounts.value.some((account) => account.id === fromZone)) return fromZone
	return accounts.value.length === 1 ? accounts.value[0].id : ''
}

// --- Period --------------------------------------------------------------------------------------
// Days are UTC, as Cloudflare records usage, and both ends are included.

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10)
const todayUtc = () => isoDate(Date.now())
const dayMs = (date) => Date.parse(`${date}T00:00:00Z`)

const presetDates = (value) => {
	const now = new Date()
	const year = now.getUTCFullYear()
	const month = now.getUTCMonth()
	if (value === 'last-month')
		return { from: isoDate(Date.UTC(year, month - 1, 1)), to: isoDate(Date.UTC(year, month, 0)) }
	if (value === '30d') return { from: isoDate(Date.now() - 29 * DAY_MS), to: todayUtc() }
	return { from: isoDate(Date.UTC(year, month, 1)), to: todayUtc() }
}

const preset = ref('month')
const fromDate = ref(presetDates('month').from)
const toDate = ref(presetDates('month').to)
// The range the sections show; it only changes to a range that passes the checks below.
const period = ref(presetDates('month'))
const inputErrors = reactive({ from: '', to: '' })
const dateError = computed(() => inputErrors.from || inputErrors.to)
let debounceTimer

const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', timeZone: 'UTC' })
const fullDay = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

const periodLabel = computed(() => {
	const { from, to } = period.value
	if (from === to) return `${fullDay.format(dayMs(from))} (UTC)`
	const start = from.slice(0, 4) === to.slice(0, 4) ? dayMonth : fullDay
	return `${start.format(dayMs(from))} to ${fullDay.format(dayMs(to))} (UTC)`
})

const validate = () => {
	inputErrors.from = DATE_RE.test(fromDate.value) ? '' : 'Enter a From date'
	inputErrors.to = DATE_RE.test(toDate.value) ? '' : 'Enter a To date'
	if (inputErrors.from || inputErrors.to) return false
	if (fromDate.value > toDate.value) inputErrors.to = 'To must be on or after From'
	else if (toDate.value > todayUtc()) inputErrors.to = 'To can’t be later than today (UTC)'
	else if (Math.round((dayMs(toDate.value) - dayMs(fromDate.value)) / DAY_MS) + 1 > MAX_DAYS) {
		inputErrors.to = `Choose ${MAX_DAYS} days or fewer`
	}
	return !inputErrors.to
}

const applyDates = () => {
	clearTimeout(debounceTimer)
	if (!validate()) return
	if (period.value.from !== fromDate.value || period.value.to !== toDate.value) {
		period.value = { from: fromDate.value, to: toDate.value }
	}
}

const selectPreset = (value) => {
	preset.value = value
	const dates = presetDates(value)
	fromDate.value = dates.from
	toDate.value = dates.to
	applyDates()
}

const onDateChange = (field, value) => {
	if (field === 'from') fromDate.value = value || ''
	else toDate.value = value || ''
	preset.value = 'custom'
	inputErrors[field] = ''
	clearTimeout(debounceTimer)
	debounceTimer = setTimeout(applyDates, INPUT_DEBOUNCE_MS)
}

// --- Account -------------------------------------------------------------------------------------

watch(
	() => queryValue(route.query.account).trim(),
	(id) => {
		if (id && id !== accountId.value) accountId.value = id
	}
)

watch(
	accountId,
	(id) => {
		if (queryValue(route.query.account) === id) return
		const query = { ...route.query }
		if (id) query.account = id
		else delete query.account
		router.replace({ query })
	},
	{ immediate: true }
)

onMounted(async () => {
	await Promise.all([loadAccounts(), loadZones()])
	if (!accountId.value) accountId.value = defaultAccount()
})

onBeforeUnmount(() => clearTimeout(debounceTimer))
</script>
