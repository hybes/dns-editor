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
						icon="i-lucide-cloud"
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

const primaryLinks = [{ label: 'Zones', icon: 'i-lucide-globe', to: '/zones', exact: true }]

const withoutFeature = ({ feature: _feature, ...item }) => item

// When the feature check itself failed, keep the sections visible so each page can show
// its own 'couldn’t check' state and retry, instead of the links silently disappearing.
const showFeature = (feature) =>
	activeZone.can(feature) || (activeZone.capabilitiesLoaded.value && !activeZone.capabilities.value)

const zoneLinks = computed(() => {
	const id = activeZoneId.value
	if (!id) return []
	const base = `/zones/${id}`
	const optional = [
		{ feature: 'rulesets', label: 'Rules', icon: 'i-lucide-shield', to: `${base}/rules` },
		{ feature: 'accountAnalytics', label: 'Analytics', icon: 'i-lucide-chart-column', to: `${base}/analytics` }
	]
	return [
		{ label: 'Overview', icon: 'i-lucide-gauge', to: base, exact: true },
		{ label: 'Records', icon: 'i-lucide-list', to: `${base}/records` },
		...optional.filter((item) => showFeature(item.feature)).map(withoutFeature)
	]
})

// Turnstile, DNS Views and DNS Firewall belong to the zone's account, not the zone, so
// they sit under the account name. The zone in the URL only tells the server which account.
const accountLinks = computed(() => {
	const id = activeZoneId.value
	if (!id) return []
	const base = `/zones/${id}`
	const links = [
		{ feature: 'turnstile', label: 'Turnstile', icon: 'i-lucide-bot', to: `${base}/turnstile` },
		{ feature: 'dnsViews', label: 'DNS Views', icon: 'i-lucide-split', to: `${base}/dns-views` },
		{
			feature: 'dnsFirewall',
			label: 'DNS Firewall',
			icon: 'i-lucide-brick-wall-shield',
			to: `${base}/dns-firewall`
		}
	]
		.filter((item) => showFeature(item.feature))
		.map(withoutFeature)
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

const accountLabel = computed(() => activeZone.zone.value?.account?.name || 'Cloudflare account')

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
	[{ type: 'label', label: accountLabel.value }],
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
		{ label: 'Replace token', icon: 'i-lucide-key-round', to: '/login?replace=1' },
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
	const sectionLinks = [...zoneLinks.value, ...(accountLinks.value[0] || []).filter((item) => item.type !== 'label')]
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
		{ label: 'Reload zone list', icon: 'i-lucide-refresh-cw', onSelect: () => loadZones({ force: true }) },
		{ label: 'Log out', icon: 'i-lucide-log-out', onSelect: logout }
	)
	groups.push({ id: 'actions', label: 'Actions', items: actions })

	return groups
})
</script>
