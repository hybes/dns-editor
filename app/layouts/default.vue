<template>
	<UDashboardGroup unit="rem">
		<UDashboardSidebar
			id="app"
			v-model:open="sidebarOpen"
			collapsible
			resizable
			:min-size="14"
			:default-size="16"
			:max-size="24"
			class="bg-elevated/40"
			:ui="{ footer: 'lg:border-t lg:border-default' }"
		>
			<template #header="{ collapsed }">
				<NuxtLink
					to="/zones"
					class="focus-visible:outline-primary flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
					:class="collapsed ? 'mx-auto' : ''"
				>
					<img src="/favicon.svg" alt="" class="size-6 shrink-0" />
					<span v-if="!collapsed" class="text-highlighted truncate font-semibold">DNS Manager</span>
					<span v-else class="sr-only">DNS Manager</span>
				</NuxtLink>
			</template>

			<template #default="{ collapsed }">
				<UDashboardSearchButton :collapsed="collapsed" class="ring-default bg-transparent" />

				<UNavigationMenu :collapsed="collapsed" :items="primaryLinks" orientation="vertical" tooltip />

				<div class="flex flex-col gap-1">
					<ZoneSwitcher
						v-if="!collapsed && (zones.length || activeZoneId)"
						:zone-id="activeZoneId"
						:zone-name="activeZone.zoneName.value"
					/>
					<UNavigationMenu
						v-if="zoneLinks.length"
						:collapsed="collapsed"
						:items="zoneLinks"
						orientation="vertical"
						tooltip
					/>
				</div>

				<UNavigationMenu
					v-if="accountLinks.length"
					:collapsed="collapsed"
					:items="accountLinks"
					orientation="vertical"
					tooltip
				/>

				<UNavigationMenu :collapsed="collapsed" :items="toolLinks" orientation="vertical" tooltip />
			</template>

			<template #footer="{ collapsed }">
				<UDropdownMenu
					:items="accountMenu"
					:content="{ align: 'center', collisionPadding: 12 }"
					:ui="{ content: collapsed ? 'w-56' : 'w-(--reka-dropdown-menu-trigger-width)' }"
				>
					<UButton
						:label="collapsed ? undefined : accountLabel"
						:aria-label="collapsed ? accountLabel : undefined"
						icon="i-lucide-circle-user-round"
						:trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
						color="neutral"
						variant="ghost"
						block
						:square="collapsed"
						class="data-[state=open]:bg-elevated"
						:ui="{ trailingIcon: 'text-dimmed' }"
					/>
				</UDropdownMenu>
			</template>
		</UDashboardSidebar>

		<UDashboardSearch :groups="searchGroups" placeholder="Jump to a zone, tool or action…" />

		<main class="flex min-w-0 flex-1">
			<slot />
		</main>
	</UDashboardGroup>
</template>

<script setup>
import { API_TOKENS_URL } from '#shared/utils/cloudflare'

const route = useRoute()
const colorMode = useColorMode()
const { logout } = useSession()
const { zones, loaded: zonesLoaded, load: loadZones, findZone } = useZones()

const sidebarOpen = ref(false)
const lastZoneId = ref(import.meta.client ? localStorage.getItem(STORAGE_KEYS.zoneId) || '' : '')

// The sidebar follows the zone in the URL, and otherwise keeps the last zone visited so
// its sections stay one click away from the zones list and the tools.
const activeZoneId = computed(() => String(route.params.zone_id || lastZoneId.value || ''))
const activeZone = useZone(activeZoneId)

watch(
	() => route.params.zone_id,
	(id) => {
		if (id) lastZoneId.value = String(id)
	}
)

watch(
	activeZoneId,
	(id) => {
		if (id) activeZone.load()
	},
	{ immediate: true }
)

// Forget a remembered zone the current token can no longer see. The route is watched too, so a
// deep link to a zone that no longer exists is dropped once the person navigates away from it.
watch([zonesLoaded, zones, () => route.params.zone_id], () => {
	if (!zonesLoaded.value || route.params.zone_id || !lastZoneId.value) return
	if (!findZone(lastZoneId.value)) lastZoneId.value = ''
})

onMounted(() => {
	loadZones()
})

const auth = useAuth()

// Registrar, usage, sharing and the Console work on the account's own connections, so someone
// who only has domains shared with them sees just Zones.
const primaryLinks = computed(() => [
	{ label: 'Zones', icon: 'i-lucide-globe', to: '/zones', exact: true },
	...(auth.connections.value.length
		? [
				{ label: 'Registrar', icon: 'i-lucide-badge-check', to: '/registrar' },
				{ label: 'Usage and billing', icon: 'i-lucide-receipt', to: '/usage' },
				{ label: 'Sharing', icon: 'i-lucide-users', to: '/sharing' },
				{ label: 'Console', icon: 'i-lucide-square-terminal', to: '/console' }
			]
		: auth.sharedWithMe.value
			? [{ label: 'Sharing', icon: 'i-lucide-users', to: '/sharing' }]
			: [])
])

const withoutFeature = ({ feature: _feature, ...item }) => item

// When the feature check itself failed, keep the sections visible so each page can show
// its own 'couldn’t check' state and retry, instead of the links silently disappearing.
const showFeature = (feature) =>
	activeZone.can(feature) || (activeZone.capabilitiesLoaded.value && !activeZone.capabilities.value)

// A page the token could use with another permission (or with R2 turned on) stays in the sidebar
// with a lock, so it can be found; the page itself says what to change. Pages the plan doesn't
// include are left out.
const LOCKED = {
	trailingIcon: 'i-lucide-lock',
	ui: { linkLabel: 'text-dimmed', linkLeadingIcon: 'text-dimmed', linkTrailingIcon: 'size-4 text-dimmed' }
}
const featureLinks = (items) =>
	items.flatMap((item) => {
		if (showFeature(item.feature)) return [withoutFeature(item)]
		if (activeZone.capabilities.value?.[item.feature]?.fixable) return [{ ...withoutFeature(item), ...LOCKED }]
		return []
	})

const zoneLinks = computed(() => {
	const id = activeZoneId.value
	if (!id) return []
	const base = `/zones/${id}`
	const optional = [
		{ feature: 'dnssec', label: 'DNSSEC', icon: 'i-lucide-key-round', to: `${base}/dnssec` },
		{
			feature: 'dnsSettings',
			label: 'DNS settings',
			icon: 'i-lucide-sliders-horizontal',
			to: `${base}/dns-settings`
		},
		{
			feature: 'zoneTransfers',
			label: 'Zone transfers',
			icon: 'i-lucide-arrow-left-right',
			to: `${base}/zone-transfers`
		},
		{ feature: 'zoneSettings', label: 'Zone settings', icon: 'i-lucide-settings', to: `${base}/settings` },
		{ feature: 'r2', label: 'Files', icon: 'i-lucide-folder-open', to: `${base}/files` },
		{ feature: 'rulesets', label: 'Rules', icon: 'i-lucide-shield', to: `${base}/rules` },
		{ feature: 'accountAnalytics', label: 'Analytics', icon: 'i-lucide-chart-column', to: `${base}/analytics` }
	]
	return [
		{ label: 'Overview', icon: 'i-lucide-gauge', to: base, exact: true },
		{ label: 'Records', icon: 'i-lucide-list', to: `${base}/records` },
		...featureLinks(optional)
	]
})

// Turnstile, DNS Views, DNS Firewall and zone transfer peers belong to the zone's account, not
// the zone, so they sit under the account name. The zone in the URL only tells the page which
// account.
const accountLinks = computed(() => {
	const id = activeZoneId.value
	// A shared zone's account belongs to its owner.
	if (!id || activeZone.access.value.shared) return []
	const base = `/zones/${id}`
	const links = featureLinks([
		{ feature: 'turnstile', label: 'Turnstile', icon: 'i-lucide-bot', to: `${base}/turnstile` },
		{ feature: 'dnsViews', label: 'DNS Views', icon: 'i-lucide-split', to: `${base}/dns-views` },
		{
			feature: 'dnsFirewall',
			label: 'DNS Firewall',
			icon: 'i-lucide-brick-wall-shield',
			to: `${base}/dns-firewall`
		},
		{ feature: 'zoneTransfers', label: 'Transfer peers', icon: 'i-lucide-network', to: `${base}/transfer-peers` }
	])
	if (!links.length) return []
	return [[{ label: activeZone.zone.value?.account?.name || 'Account', type: 'label' }, ...links]]
})

const toolLinks = [
	[
		{ label: 'Tools', type: 'label' },
		{ label: 'DNS Lookup', icon: 'i-lucide-text-search', to: '/tools/dns-lookup' },
		{ label: 'Propagation Check', icon: 'i-lucide-radar', to: '/tools/propagation' },
		{ label: 'Domain Search', icon: 'i-lucide-shopping-cart', to: '/tools/domain-search' }
	]
]

const accountLabel = computed(() => auth.user.value?.username || 'Your account')

const themeItem = (preference, label, icon) => ({
	label,
	icon,
	type: 'checkbox',
	checked: colorMode.preference === preference,
	onSelect: (event) => {
		event.preventDefault()
		colorMode.preference = preference
	}
})

const accountMenu = computed(() => [
	[{ type: 'label', label: `Signed in as ${accountLabel.value}` }],
	[
		{ label: 'Cloudflare connections', icon: 'i-lucide-key-round', to: '/connections' },
		{ label: 'Your account', icon: 'i-lucide-user-round', to: '/account' }
	],
	[
		{
			label: 'Appearance',
			icon: 'i-lucide-sun-moon',
			children: [
				themeItem('system', 'System', 'i-lucide-monitor'),
				themeItem('light', 'Light', 'i-lucide-sun'),
				themeItem('dark', 'Dark', 'i-lucide-moon')
			]
		},
		{
			label: 'Manage API tokens',
			icon: 'i-lucide-external-link',
			to: API_TOKENS_URL,
			target: '_blank'
		}
	],
	[{ label: 'Log out', icon: 'i-lucide-log-out', onSelect: logout }]
])

const searchGroups = computed(() => {
	const groups = [
		{
			id: 'zones',
			label: 'Zones',
			items: zones.value.map((zone) => ({
				label: zone.name,
				suffix: zone.status === 'active' ? undefined : zone.status,
				icon: 'i-lucide-globe',
				to: `/zones/${zone.id}/records`
			}))
		}
	]

	const zoneName = activeZone.zoneName.value
	// Locked pages keep their place in search, marked instead of styled as in the sidebar.
	const sectionLinks = [
		...zoneLinks.value,
		...(accountLinks.value[0] || []).filter((item) => item.type !== 'label')
	].map(({ trailingIcon, ui: _ui, ...item }) =>
		trailingIcon ? { ...item, suffix: 'Needs more token access' } : item
	)
	if (sectionLinks.length) {
		groups.push({ id: 'zone', label: zoneName || 'Current zone', items: sectionLinks })
	}

	groups.push({ id: 'tools', label: 'Tools', items: toolLinks[0].filter((item) => item.type !== 'label') })

	const actions = []
	if (activeZoneId.value) {
		actions.push({
			label: zoneName ? `Add a record to ${zoneName}` : 'Add a record',
			icon: 'i-lucide-plus',
			to: `/zones/${activeZoneId.value}/records/create`
		})
	}
	actions.push(
		{
			label: 'Run a cf command',
			icon: 'i-lucide-square-terminal',
			to: activeZoneId.value ? { path: '/console', query: { zone: activeZoneId.value } } : '/console'
		},
		{ label: 'Reload zone list', icon: 'i-lucide-refresh-cw', onSelect: () => loadZones({ force: true }) },
		{ label: 'Log out', icon: 'i-lucide-log-out', onSelect: logout }
	)
	groups.push({ id: 'actions', label: 'Actions', items: actions })

	return groups
})
</script>
