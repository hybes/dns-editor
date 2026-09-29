<template>
	<UDashboardPanel id="zone-settings">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span>Zone settings</span>
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
							:aria-label="zoneName ? `Refresh settings for ${zoneName}` : 'Refresh zone settings'"
							@click="refreshAll"
						/>
					</UTooltip>
					<UButton
						v-if="zoneId"
						label="All settings in Console"
						aria-label="All settings in Console"
						icon="i-lucide-square-terminal"
						color="neutral"
						variant="outline"
						:to="{ path: '/console', query: { command: 'zones settings get', zone: zoneId } }"
						:ui="{ label: 'hidden sm:inline' }"
					/>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="mx-auto flex w-full max-w-3xl flex-col gap-10">
				<ZoneAccessNote
					v-if="zoneAccess.shared"
					:access="zoneAccess"
					area="settings"
					subject="these settings"
					class="-mb-6"
				/>
				<AccountFeatureGate
					:loaded="capabilitiesLoaded"
					:available="canUse"
					feature="zone settings"
					:reason="accessReason"
					hint="Give the token Zone Settings Read for this zone, and Zone Settings Edit to make changes, then check again."
					:checking="zoneLoading"
					@retry="refreshZone"
				>
					<p class="text-muted text-sm">
						Each change is saved to Cloudflare straight away. These settings apply to proxied records.
						DNS-only records send visitors straight to your server.
					</p>

					<section
						v-for="group in groups"
						:key="group.id"
						:aria-labelledby="`${group.id}-heading`"
						class="flex flex-col gap-3"
					>
						<div class="flex flex-col gap-1">
							<h2 :id="`${group.id}-heading`" class="text-highlighted text-base font-semibold">
								{{ group.title }}
							</h2>
							<p v-if="group.linksToOverview" class="text-muted text-sm">
								The SSL/TLS encryption mode is set on the
								<ULink
									raw
									:to="`/zones/${zoneId}`"
									class="text-primary focus-visible:outline-primary rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
									>Overview</ULink
								>.
							</p>
						</div>

						<ul class="divide-default border-default divide-y border-y text-sm">
							<li
								v-for="{ setting, state } in group.rows"
								:key="setting.id"
								:aria-busy="state.status === 'loading'"
								:class="[
									'flex gap-x-6 gap-y-3 py-3',
									setting.kind === SELECT
										? 'flex-col sm:flex-row sm:items-start sm:justify-between'
										: 'items-start justify-between'
								]"
							>
								<div class="flex min-w-0 flex-1 flex-col gap-1">
									<component
										:is="hasControl(setting, state) ? 'label' : 'p'"
										:for="hasControl(setting, state) ? controlId(setting) : undefined"
										class="text-highlighted font-medium"
									>
										{{ setting.label }}
									</component>
									<p :id="descriptionId(setting)" class="text-muted">{{ setting.description }}</p>

									<template v-if="state.status === 'ready'">
										<p v-if="unrecognised(setting, state)" class="text-muted">
											Cloudflare reports “{{ state.value }}”, which this page doesn’t recognise.
											{{
												setting.kind === SELECT
													? 'Choosing another option replaces it.'
													: 'Change it in the Console instead.'
											}}
										</p>
										<p v-if="!state.editable" class="text-muted">
											Cloudflare doesn’t allow this to be changed on this zone.
										</p>
										<p v-if="remainingLabel(state)" class="text-muted">
											Turns itself off in about
											<time
												:datetime="new Date(state.expiresAt).toISOString()"
												:title="formatDate(state.expiresAt, 'full')"
												>{{ remainingLabel(state) }}</time
											>.
										</p>
										<p v-if="formatDate(state.modifiedOn)" class="text-muted text-xs">
											Last changed
											<time :datetime="state.modifiedOn">{{
												formatDate(state.modifiedOn, 'datetime')
											}}</time>
										</p>
									</template>
									<p v-else-if="state.status === 'refused'" class="text-muted">
										Cloudflare said: {{ state.message }}
									</p>
									<p v-else-if="state.status === 'failed'" class="text-error">
										Couldn’t load this setting. {{ state.message }}
									</p>
								</div>

								<div class="flex shrink-0 sm:w-56 sm:justify-end">
									<template v-if="state.status === 'loading'">
										<span class="sr-only">Loading {{ setting.label }}…</span>
										<USkeleton :class="setting.kind === SELECT ? 'h-8 w-full' : 'h-5 w-9'" />
									</template>
									<template v-else-if="hasControl(setting, state)">
										<USwitch
											v-if="setting.kind === TOGGLE"
											:id="controlId(setting)"
											:model-value="state.value === 'on'"
											:loading="state.saving"
											:disabled="state.saving || !state.editable || !canEdit"
											:aria-describedby="descriptionId(setting)"
											@update:model-value="
												(checked) => requestChange(setting, checked ? 'on' : 'off')
											"
										/>
										<USelect
											v-else
											:id="controlId(setting)"
											:model-value="state.value"
											:items="itemsFor(setting, state)"
											:loading="state.saving"
											:disabled="state.saving || !state.editable || !canEdit"
											:aria-describedby="descriptionId(setting)"
											class="w-full"
											@update:model-value="(value) => requestChange(setting, value)"
										/>
									</template>
									<UButton
										v-else-if="state.status !== 'ready'"
										:label="state.status === 'failed' ? 'Try again' : 'Check again'"
										:aria-label="`Check ${setting.label} again`"
										size="xs"
										color="neutral"
										variant="outline"
										@click="retry(setting)"
									/>
								</div>
							</li>
						</ul>
					</section>
				</AccountFeatureGate>
			</div>

			<UModal
				v-model:open="confirmOpen"
				:title="pending?.setting.confirm.title"
				:dismissible="!pendingSaving"
				:close="!pendingSaving"
				@after:leave="pending = null"
			>
				<template #body>
					<div class="flex flex-col gap-3 text-sm">
						<p class="text-default">{{ pending?.setting.confirm.message(zoneName || 'this zone') }}</p>
						<UAlert
							v-if="confirmError"
							role="alert"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							title="Cloudflare didn’t change the setting"
							:description="confirmError"
						/>
					</div>
				</template>
				<template #footer>
					<div class="flex w-full flex-wrap justify-end gap-2">
						<UButton
							label="Keep current setting"
							color="neutral"
							variant="ghost"
							:disabled="pendingSaving"
							@click="confirmOpen = false"
						/>
						<UButton
							:label="pending?.setting.confirm.action"
							:color="pending?.setting.confirm.color || 'error'"
							:loading="pendingSaving"
							@click="confirmChange"
						/>
					</div>
				</template>
			</UModal>
		</template>
	</UDashboardPanel>
</template>

<script setup>
import { useNow } from '@vueuse/core'

const TOGGLE = 'toggle'
const SELECT = 'select'

const TLS_VERSIONS = [
	{ value: '1.0', label: 'TLS 1.0' },
	{ value: '1.1', label: 'TLS 1.1' },
	{ value: '1.2', label: 'TLS 1.2' },
	{ value: '1.3', label: 'TLS 1.3' }
]

const PSEUDO_IPV4_MODES = [
	{ value: 'off', label: 'Off' },
	{
		value: 'add_header',
		label: 'Add header',
		description: 'Adds a Cf-Pseudo-IPv4 header with the stand-in address.'
	},
	{
		value: 'overwrite_header',
		label: 'Overwrite headers',
		description:
			'Puts the stand-in address in Cf-Connecting-IP and X-Forwarded-For. The real address stays in CF-Connecting-IPv6.'
	}
]

const SECURITY_LEVELS = [
	{ value: 'off', label: 'Off' },
	{ value: 'essentially_off', label: 'Essentially off' },
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' },
	{
		value: 'under_attack',
		label: 'I’m Under Attack',
		description: 'Shows every visitor a Managed Challenge page first.'
	}
]

// Cloudflare accepts only these (seconds).
const CHALLENGE_TTLS = [
	{ value: 300, label: '5 minutes' },
	{ value: 900, label: '15 minutes' },
	{ value: 1800, label: '30 minutes' },
	{ value: 2700, label: '45 minutes' },
	{ value: 3600, label: '1 hour' },
	{ value: 7200, label: '2 hours' },
	{ value: 10800, label: '3 hours' },
	{ value: 14400, label: '4 hours' },
	{ value: 28800, label: '8 hours' },
	{ value: 57600, label: '16 hours' },
	{ value: 86400, label: '1 day' },
	{ value: 604800, label: '1 week' },
	{ value: 2592000, label: '30 days' },
	{ value: 31536000, label: '1 year' }
]

// Any number of seconds is valid; these are the dashboard's choices. 0 respects the origin's headers.
const BROWSER_CACHE_TTLS = [
	{ value: 0, label: 'Respect existing headers' },
	{ value: 30, label: '30 seconds' },
	{ value: 60, label: '1 minute' },
	{ value: 120, label: '2 minutes' },
	{ value: 300, label: '5 minutes' },
	{ value: 1200, label: '20 minutes' },
	{ value: 1800, label: '30 minutes' },
	{ value: 3600, label: '1 hour' },
	{ value: 7200, label: '2 hours' },
	{ value: 10800, label: '3 hours' },
	{ value: 14400, label: '4 hours' },
	{ value: 18000, label: '5 hours' },
	{ value: 28800, label: '8 hours' },
	{ value: 43200, label: '12 hours' },
	{ value: 57600, label: '16 hours' },
	{ value: 72000, label: '20 hours' },
	{ value: 86400, label: '1 day' },
	{ value: 172800, label: '2 days' },
	{ value: 259200, label: '3 days' },
	{ value: 345600, label: '4 days' },
	{ value: 432000, label: '5 days' },
	{ value: 691200, label: '8 days' },
	{ value: 1382400, label: '16 days' },
	{ value: 2073600, label: '24 days' },
	{ value: 2678400, label: '1 month' },
	{ value: 5356800, label: '2 months' },
	{ value: 16070400, label: '6 months' },
	{ value: 31536000, label: '1 year' }
]

const CACHE_LEVELS = [
	{
		value: 'basic',
		label: 'No query string',
		description: 'Serves from cache only when the URL has no query string.'
	},
	{
		value: 'simplified',
		label: 'Ignore query string',
		description: 'Serves the same cached file to everyone, whatever the query string.'
	},
	{
		value: 'aggressive',
		label: 'Standard',
		description: 'Caches all static content, including URLs with a query string.'
	}
]

// The settings this page shows, by `zones settings get` setting ID. Values and descriptions
// follow cf's SDK types. kind: TOGGLE (on/off) or SELECT (one of `options`); numeric
// settings are seconds. confirm.when(next, current) decides whether to ask before saving.
const SETTING_GROUPS = [
	{
		id: 'https',
		title: 'HTTPS and TLS',
		linksToOverview: true,
		settings: [
			{
				id: 'always_use_https',
				label: 'Always Use HTTPS',
				kind: TOGGLE,
				description: 'Redirects every http:// request to the same URL on https:// with a 301.'
			},
			{
				id: 'automatic_https_rewrites',
				label: 'Automatic HTTPS Rewrites',
				kind: TOGGLE,
				description:
					'Rewrites http:// links in your pages to https:// where the resource is available over HTTPS, so browsers don’t report mixed content.'
			},
			{
				id: 'min_tls_version',
				label: 'Minimum TLS version',
				kind: SELECT,
				options: TLS_VERSIONS,
				description:
					'Rejects HTTPS connections that use an older version. For example, TLS 1.1 rejects TLS 1.0 but accepts 1.1, 1.2 and 1.3.',
				confirm: {
					when: (next, current) => next === '1.3' && current !== '1.3',
					title: 'Require TLS 1.3?',
					message: (zone) =>
						`Browsers, apps and other clients that only support TLS 1.2 or older won’t be able to connect to ${zone} over HTTPS.`,
					action: 'Require TLS 1.3'
				}
			},
			{
				id: 'tls_1_3',
				label: 'TLS 1.3',
				kind: TOGGLE,
				description: 'Lets browsers that support it connect using TLS 1.3.'
			},
			{
				id: 'opportunistic_encryption',
				label: 'Opportunistic Encryption',
				kind: TOGGLE,
				description:
					'Lets browsers reach http:// URLs over an encrypted connection. It doesn’t replace HTTPS, and browsers still don’t show the site as secure.'
			}
		]
	},
	{
		id: 'network',
		title: 'Network',
		settings: [
			{
				id: 'ipv6',
				label: 'IPv6 compatibility',
				kind: TOGGLE,
				description: 'Makes proxied hostnames reachable over IPv6.'
			},
			{
				id: 'http3',
				label: 'HTTP/3 (with QUIC)',
				kind: TOGGLE,
				description: 'Lets browsers that support it connect over HTTP/3, which runs on QUIC.'
			},
			{
				id: '0rtt',
				label: '0-RTT Connection Resumption',
				kind: TOGGLE,
				description:
					'Lets visitors who have connected before resume a TLS 1.3 connection without an extra round trip.'
			},
			{
				id: 'websockets',
				label: 'WebSockets',
				kind: TOGGLE,
				description:
					'Allows WebSocket connections through Cloudflare to your server, for real-time features such as chat.'
			},
			{
				id: 'pseudo_ipv4',
				label: 'Pseudo IPv4',
				kind: SELECT,
				options: PSEUDO_IPV4_MODES,
				description:
					'Gives IPv6 visitors a stand-in IPv4 address from the reserved Class E range, for servers that only handle IPv4.'
			},
			{
				id: 'ip_geolocation',
				label: 'IP Geolocation',
				kind: TOGGLE,
				description:
					'Adds the visitor’s country code to requests sent to your server, in the CF-IPCountry header.'
			},
			{
				id: 'opportunistic_onion',
				label: 'Onion Routing',
				kind: TOGGLE,
				description:
					'Lets Tor visitors reach the site through Cloudflare’s onion service instead of a Tor exit node.'
			}
		]
	},
	{
		id: 'security',
		title: 'Security',
		settings: [
			{
				id: 'security_level',
				label: 'Security level',
				kind: SELECT,
				options: SECURITY_LEVELS,
				description:
					'Turns I’m Under Attack mode on or off. The other levels were based on visitors’ threat scores, which Cloudflare no longer sets.',
				confirm: {
					when: (next, current) => next === 'under_attack' && current !== 'under_attack',
					title: 'Turn on I’m Under Attack mode?',
					message: (zone) =>
						`Every visitor to ${zone} will see a Managed Challenge page before the site loads, and browsers without JavaScript can’t pass it. It can also stop API clients and other automated traffic. Use it only while the site is under a DDoS attack.`,
					action: 'Turn on Under Attack mode'
				}
			},
			{
				id: 'challenge_ttl',
				label: 'Challenge Passage',
				kind: SELECT,
				numeric: true,
				options: CHALLENGE_TTLS,
				description:
					'How long a visitor who passes a challenge can use the site before being challenged again. Cloudflare recommends 15 to 45 minutes.'
			},
			{
				id: 'browser_check',
				label: 'Browser Integrity Check',
				kind: TOGGLE,
				description:
					'Challenges or blocks requests with headers commonly used by spammers, including a missing or non-standard user agent.'
			},
			{
				id: 'email_obfuscation',
				label: 'Email Address Obfuscation',
				kind: TOGGLE,
				description: 'Hides email addresses on your pages from bots while keeping them visible to people.'
			},
			{
				id: 'hotlink_protection',
				label: 'Hotlink Protection',
				kind: TOGGLE,
				description:
					'Stops other sites embedding your GIF, ICO, JPEG and PNG images, based on the Referer header.'
			}
		]
	},
	{
		id: 'caching',
		title: 'Caching and speed',
		settings: [
			{
				id: 'development_mode',
				label: 'Development Mode',
				kind: TOGGLE,
				description:
					'Bypasses Cloudflare’s cache so changes to images, CSS and JavaScript show straight away. The site is slower while it’s on, and it turns itself off after 3 hours.',
				confirm: {
					when: (next) => next === 'on',
					title: 'Turn on Development Mode?',
					message: (zone) =>
						`Cloudflare will stop serving ${zone} from its cache, so every request goes to your server and the site will be slower. Development Mode turns itself off after 3 hours.`,
					action: 'Turn on for 3 hours',
					color: 'warning'
				}
			},
			{
				id: 'always_online',
				label: 'Always Online',
				kind: TOGGLE,
				description:
					'If your server is offline, Cloudflare serves limited copies of your pages from the Internet Archive’s Wayback Machine.'
			},
			{
				id: 'browser_cache_ttl',
				label: 'Browser Cache TTL',
				kind: SELECT,
				numeric: true,
				options: BROWSER_CACHE_TTLS,
				description:
					'How long visitors’ browsers keep resources Cloudflare has cached. Cloudflare keeps any longer time your server sets, and “Respect existing headers” leaves your server’s Cache-Control headers as they are.'
			},
			{
				id: 'cache_level',
				label: 'Caching level',
				kind: SELECT,
				options: CACHE_LEVELS,
				description: 'How Cloudflare caches static content depending on the query string.'
			},
			{
				id: 'rocket_loader',
				label: 'Rocket Loader',
				kind: TOGGLE,
				description: 'Loads your pages’ JavaScript after the content, so pages start rendering sooner.'
			},
			{
				id: 'early_hints',
				label: 'Early Hints',
				kind: TOGGLE,
				description:
					'Sends browsers a 103 Early Hints response with your page’s Link headers, so they can start loading assets sooner.'
			}
		]
	}
]

const ALL_SETTINGS = SETTING_GROUPS.flatMap((group) => group.settings)
// Settings are read one request each, a few at a time, to stay clear of Cloudflare's rate limits.
const CONCURRENCY = 6

const route = useRoute()
const { exec } = useCfCommands()
const { success: notifySuccess, error: notifyError } = useNotify()
const { formatTtl } = useRecordTypes()
const now = useNow({ interval: 30_000 })

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

const canUse = computed(() => can('zoneSettings'))
// On a zone shared with this account, whether its settings level lets the person change them.
const canEdit = computed(() => allowed('settings', 'edit'))
const accessReason = computed(() => missingCapabilities.value.find((item) => item.key === 'zoneSettings')?.reason || '')

useSeoMeta({ title: () => (zoneName.value ? `Zone settings · ${zoneName.value}` : 'Zone settings') })

watch(
	zoneId,
	(id) => {
		if (id) loadZone()
	},
	{ immediate: true }
)

// --- Per-setting state -------------------------------------------------------------------

// status: loading, ready, refused (Cloudflare answered with an error, such as a plan that
// doesn't include the setting) or failed (Cloudflare couldn't be reached).
const blankState = () => ({
	status: 'loading',
	value: null,
	editable: true,
	modifiedOn: '',
	expiresAt: 0,
	message: '',
	saving: false
})

const states = ref({})
const stateOf = (id) => states.value[id] || blankState()
const patchState = (id, changes) => {
	states.value[id] = { ...stateOf(id), ...changes }
}

const groups = computed(() =>
	SETTING_GROUPS.map((group) => ({
		...group,
		rows: group.settings.map((setting) => ({ setting, state: stateOf(setting.id) }))
	}))
)

// The latest request for each setting. An answer to an older one, or for another zone, is dropped.
const tickets = new Map()
let ticketCount = 0
const takeTicket = (id) => {
	ticketCount += 1
	tickets.set(id, ticketCount)
	return ticketCount
}

const readValue = (setting, value) =>
	setting.numeric && value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : value

const fromResult = (setting, result) => {
	const value = readValue(setting, result?.value)
	if (value === undefined || value === null) {
		return { status: 'refused', message: 'Cloudflare didn’t return a value for this setting.' }
	}
	// Development Mode reports the seconds left, or negative seconds once it has ended.
	const remaining = Number(result?.time_remaining)
	return {
		status: 'ready',
		value,
		editable: result?.editable !== false,
		modifiedOn: result?.modified_on || '',
		expiresAt: value === 'on' && remaining > 0 ? Date.now() + remaining * 1000 : 0,
		message: ''
	}
}

const fetchSetting = async (zone, setting) => {
	const ticket = takeTicket(setting.id)
	const isCurrent = () => zone === zoneId.value && tickets.get(setting.id) === ticket
	// A refresh keeps the current value on screen; only first loads and retries show a skeleton.
	if (stateOf(setting.id).status !== 'ready') patchState(setting.id, { status: 'loading', message: '' })
	try {
		const response = await exec(
			'zones settings get',
			{ zone, args: { 'setting-id': setting.id } },
			{ fallback: 'Cloudflare didn’t return this setting' }
		)
		if (isCurrent()) patchState(setting.id, fromResult(setting, response?.result))
	} catch (err) {
		if (!isCurrent()) return
		patchState(setting.id, {
			status: err instanceof CfApiError ? 'refused' : 'failed',
			message: describeError(err, 'Cloudflare didn’t return this setting')
		})
	}
}

let loadRun = 0
const loadingAll = ref(false)
const loadedZone = ref('')

const loadAll = async () => {
	const zone = zoneId.value
	if (!zone || !canUse.value) return
	loadRun += 1
	const run = loadRun
	loadedZone.value = zone
	loadingAll.value = true
	const queue = [...ALL_SETTINGS]
	const worker = async () => {
		while (queue.length && run === loadRun && zone === zoneId.value) await fetchSetting(zone, queue.shift())
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker))
	if (run === loadRun) loadingAll.value = false
}

const retry = (setting) => {
	if (zoneId.value) fetchSetting(zoneId.value, setting)
}

const refreshing = computed(() => loadingAll.value || zoneLoading.value)
const refreshAll = () => Promise.all([refreshZone(), loadAll()])

// --- Display -----------------------------------------------------------------------------

const controlId = (setting) => `setting-${setting.id}`
const descriptionId = (setting) => `setting-${setting.id}-description`

// Seconds outside the option lists. formatTtl reads 1 as DNS's "Auto", which doesn't apply here.
const durationLabel = (seconds) =>
	Number(seconds) === 1 ? '1 second' : formatTtl(seconds, { style: 'long' }) || `${seconds} seconds`

const unrecognised = (setting, state) => {
	if (setting.kind === TOGGLE) return state.value !== 'on' && state.value !== 'off'
	return !setting.numeric && !setting.options.some((item) => item.value === state.value)
}

// A toggle with a value it can't show as on or off gets no switch, so it can't be changed by accident.
const hasControl = (setting, state) =>
	state.status === 'ready' && (setting.kind === SELECT || !unrecognised(setting, state))

// A value Cloudflare reports that isn't in the list is shown as its own option, so the select
// never looks empty.
const itemsFor = (setting, state) => {
	const { value } = state
	if (setting.options.some((item) => item.value === value)) return setting.options
	const extra = { value, label: setting.numeric ? durationLabel(value) : `“${value}”` }
	return setting.numeric ? [...setting.options, extra].sort((a, b) => a.value - b.value) : [extra, ...setting.options]
}

const optionLabel = (setting, value) =>
	setting.options?.find((item) => item.value === value)?.label ||
	(setting.numeric ? durationLabel(value) : `“${value}”`)

const changeTitle = (setting, value) =>
	setting.kind === TOGGLE
		? `${setting.label} turned ${value === 'on' ? 'on' : 'off'}`
		: `${setting.label} set to ${optionLabel(setting, value)}`

const remainingLabel = (state) => {
	const left = state.expiresAt - now.value.getTime()
	if (state.value !== 'on' || left <= 0) return ''
	return formatTtl(Math.ceil(left / 60_000) * 60, { style: 'long' })
}

// --- Changes -----------------------------------------------------------------------------

const confirmOpen = ref(false)
const confirmError = ref('')
// { setting, value } waiting for confirmation
const pending = shallowRef(null)
const pendingSaving = computed(() => Boolean(pending.value && stateOf(pending.value.setting.id).saving))

const requestChange = (setting, next) => {
	const state = stateOf(setting.id)
	if (state.status !== 'ready' || state.saving || next === state.value) return
	if (setting.confirm?.when(next, state.value)) {
		pending.value = { setting, value: next }
		confirmError.value = ''
		confirmOpen.value = true
		return
	}
	saveSetting(setting, next)
}

const confirmChange = () => {
	if (pending.value) saveSetting(pending.value.setting, pending.value.value)
}

// Optimistic: the control moves at once and goes back if Cloudflare refuses.
const saveSetting = async (setting, next) => {
	const zone = zoneId.value
	const state = stateOf(setting.id)
	if (!zone || state.status !== 'ready' || state.saving) return
	const previous = state.value
	const inModal = confirmOpen.value && pending.value?.setting.id === setting.id
	// A read still in flight would put the old value back.
	takeTicket(setting.id)
	patchState(setting.id, { value: next, saving: true })
	confirmError.value = ''
	try {
		const response = await exec(
			'zones settings edit',
			{ zone, args: { 'setting-id': setting.id }, body: { value: next } },
			{ fallback: 'Cloudflare rejected the change' }
		)
		if (zone !== zoneId.value) return
		const confirmed = fromResult(setting, response?.result)
		const value = confirmed.status === 'ready' ? confirmed.value : next
		patchState(setting.id, confirmed.status === 'ready' ? confirmed : { value })
		if (inModal) confirmOpen.value = false
		notifySuccess(changeTitle(setting, value), zoneName.value || undefined)
	} catch (err) {
		if (zone !== zoneId.value) return
		patchState(setting.id, { value: previous })
		if (inModal && confirmOpen.value) confirmError.value = describeError(err, 'Cloudflare rejected the change')
		else notifyError(`Couldn’t change ${setting.label}`, err, 'Cloudflare rejected the change')
	} finally {
		if (zone === zoneId.value) patchState(setting.id, { saving: false })
	}
}

// --- Zone changes ------------------------------------------------------------------------

const resetStates = () => {
	loadRun += 1
	tickets.clear()
	loadingAll.value = false
	loadedZone.value = ''
	states.value = Object.fromEntries(ALL_SETTINGS.map((setting) => [setting.id, blankState()]))
	confirmOpen.value = false
}

watch(
	[zoneId, canUse],
	([id, allowed], previous) => {
		if (!previous || previous[0] !== id) resetStates()
		if (id && allowed && loadedZone.value !== id) loadAll()
	},
	{ immediate: true }
)
</script>
