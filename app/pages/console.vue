<template>
	<div class="flex min-w-0 flex-1">
		<UDashboardPanel
			v-if="!isMobile || !selectedName"
			id="console-commands"
			:default-size="24"
			:min-size="18"
			:max-size="36"
			resizable
		>
			<template #header>
				<UDashboardNavbar title="Console">
					<template #leading>
						<UDashboardSidebarCollapse />
					</template>
					<template #right>
						<UTooltip v-if="catalogue" :text="`Commands from cf ${catalogue.version}`">
							<ULink
								:to="catalogue.source"
								target="_blank"
								class="text-muted hover:text-default rounded-sm font-mono text-xs"
							>
								cf {{ catalogue.version }}
								<span class="sr-only">(source, opens in a new tab)</span>
							</ULink>
						</UTooltip>
					</template>
				</UDashboardNavbar>
			</template>

			<template #body>
				<ConsoleCommandBrowser :selected="selectedName" @select="select" />
			</template>
		</UDashboardPanel>

		<UDashboardPanel v-if="!isMobile || selectedName" id="console-command">
			<template #header>
				<UDashboardNavbar :title="isMobile ? 'Console' : ''">
					<template #leading>
						<UButton
							v-if="isMobile"
							icon="i-lucide-arrow-left"
							color="neutral"
							variant="ghost"
							aria-label="Back to commands"
							@click="select('')"
						/>
					</template>
				</UDashboardNavbar>
			</template>

			<template #body>
				<div v-if="loading" class="mx-auto flex w-full max-w-3xl flex-col gap-4" aria-busy="true">
					<span class="sr-only">Loading cf {{ selectedName }}…</span>
					<USkeleton class="h-7 w-72" />
					<USkeleton class="h-5 w-full" />
					<USkeleton v-for="row in 4" :key="row" class="h-14 w-full" />
				</div>

				<UAlert
					v-else-if="error"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					:title="`Couldn’t open cf ${selectedName}`"
					:description="error"
					class="mx-auto w-full max-w-3xl"
					:actions="[
						{
							label: 'Try again',
							icon: 'i-lucide-refresh-cw',
							color: 'neutral',
							variant: 'outline',
							onClick: loadCommand
						},
						{ label: 'Back to commands', color: 'neutral', variant: 'outline', onClick: () => select('') }
					]"
				/>

				<ConsoleCommandRunner v-else-if="command" :command="command" :initial-zone-id="initialZoneId" />

				<UEmpty
					v-else
					variant="naked"
					icon="i-lucide-square-terminal"
					title="Run any cf command"
					:description="introText"
					class="my-auto"
				/>
			</template>
		</UDashboardPanel>
	</div>
</template>

<script setup>
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'

// Every Cloudflare API command in cf, the Cloudflare CLI: find one by searching or browsing,
// fill in its flags and run it with the saved token. The chosen command lives in the URL
// (/console?command=dns+records+list), and ?zone=<id> picks the zone to start on.

const route = useRoute()
const router = useRouter()
const { getCommand, browse } = useCfCommands()
const isMobile = useBreakpoints(breakpointsTailwind).smaller('lg')

const queryValue = (value) => (typeof value === 'string' ? value : Array.isArray(value) ? value[0] || '' : '')
const selectedName = computed(() => queryValue(route.query.command).trim())
const initialZoneId = computed(
	() => queryValue(route.query.zone) || (import.meta.client ? localStorage.getItem(STORAGE_KEYS.zoneId) || '' : '')
)

const command = ref(null)
const loading = ref(false)
const error = ref('')
const catalogue = ref(null)

useSeoMeta({ title: () => (selectedName.value ? `cf ${selectedName.value} · Console` : 'Console') })

const select = (name) => {
	const query = { ...route.query }
	if (name) query.command = name
	else delete query.command
	router.push({ query })
}

let token = 0
const loadCommand = async () => {
	const name = selectedName.value
	const current = ++token
	error.value = ''
	if (!name) {
		command.value = null
		loading.value = false
		return
	}
	loading.value = true
	try {
		const found = await getCommand(name)
		if (current === token) command.value = found
	} catch (reason) {
		if (current === token) {
			command.value = null
			error.value = describeError(reason, 'Try again in a moment.')
		}
	} finally {
		if (current === token) loading.value = false
	}
}

watch(selectedName, loadCommand, { immediate: true })

onMounted(async () => {
	try {
		catalogue.value = await browse('')
	} catch {
		// The browser panel shows its own error and retry.
	}
})

const introText = computed(() => {
	const count = catalogue.value?.total ? `${formatNumber(catalogue.value.total)} ` : ''
	return `Search or browse the ${count}Cloudflare API commands in cf. Each one lists its flags and the cf command line, and a dry run shows the request before anything is sent.`
})
</script>
