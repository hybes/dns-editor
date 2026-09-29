<template>
	<div class="flex min-h-0 flex-1 flex-col gap-4">
		<UFormField label="Search commands" name="console-search" :ui="{ labelWrapper: 'sr-only' }">
			<UInput
				ref="searchField"
				v-model="query"
				type="search"
				icon="i-lucide-search"
				placeholder="What do you want to do?"
				autocomplete="off"
				:spellcheck="false"
				:loading="searching"
				class="w-full"
				@keydown.down.prevent="focusFirstResult"
			>
				<template #trailing>
					<UKbd value="/" class="hidden sm:inline-flex" />
				</template>
			</UInput>
		</UFormField>

		<p class="sr-only" role="status" aria-live="polite">{{ liveStatus }}</p>

		<UAlert
			v-if="error"
			color="error"
			variant="subtle"
			icon="i-lucide-circle-alert"
			:title="query.trim() ? 'Search didn’t work' : 'Couldn’t list the commands'"
			:description="error"
			:actions="[
				{
					label: 'Try again',
					icon: 'i-lucide-refresh-cw',
					color: 'neutral',
					variant: 'outline',
					onClick: retry
				}
			]"
		/>

		<template v-else-if="query.trim()">
			<ul v-if="results.length" ref="resultList" class="flex flex-col gap-0.5" aria-label="Matching commands">
				<li v-for="item in results" :key="item.command">
					<button type="button" :class="itemClass(item.command)" @click="emit('select', item.command)">
						<span class="flex min-w-0 items-center gap-2">
							<span class="text-highlighted truncate font-mono text-sm">{{ item.command }}</span>
							<UBadge v-if="item.local" color="neutral" variant="outline" size="sm" label="Local" />
						</span>
						<span class="text-muted line-clamp-2 text-xs">{{ item.summary }}</span>
					</button>
				</li>
			</ul>
			<UEmpty
				v-else-if="!searching"
				variant="naked"
				icon="i-lucide-search-x"
				title="No commands match"
				:description="`cf has no command that matches “${query.trim()}”. Try describing the task another way, such as “list dns records”.`"
			/>
		</template>

		<template v-else>
			<section
				v-if="recent.length && !prefix"
				aria-labelledby="console-recent-heading"
				class="flex flex-col gap-1"
			>
				<div class="flex items-center justify-between gap-2">
					<h2 id="console-recent-heading" class="text-muted text-xs font-medium">Recent</h2>
					<UButton label="Clear" color="neutral" variant="link" size="xs" class="px-0" @click="recent = []" />
				</div>
				<ul class="flex flex-col gap-0.5">
					<li v-for="name in recent" :key="name">
						<button type="button" :class="itemClass(name)" @click="emit('select', name)">
							<span class="text-highlighted truncate font-mono text-sm">{{ name }}</span>
						</button>
					</li>
				</ul>
			</section>

			<section aria-labelledby="console-browse-heading" class="flex min-h-0 flex-col gap-2">
				<div class="flex min-w-0 flex-col gap-1">
					<h2 id="console-browse-heading" class="text-muted text-xs font-medium">
						{{ prefix ? 'Commands in' : 'All commands' }}
					</h2>
					<nav v-if="prefix" aria-label="Command group" class="flex min-w-0 flex-wrap items-center gap-1">
						<UButton
							label="cf"
							color="neutral"
							variant="link"
							size="xs"
							class="px-0 font-mono"
							@click="openGroup('')"
						/>
						<template v-for="(crumb, index) in crumbs" :key="crumb.prefix">
							<UIcon name="i-lucide-chevron-right" class="text-dimmed size-3.5" aria-hidden="true" />
							<UButton
								v-if="index < crumbs.length - 1"
								:label="crumb.word"
								color="neutral"
								variant="link"
								size="xs"
								class="px-0 font-mono"
								@click="openGroup(crumb.prefix)"
							/>
							<span v-else class="text-highlighted font-mono text-xs" aria-current="page">{{
								crumb.word
							}}</span>
						</template>
					</nav>
					<p v-if="level?.description" class="text-muted text-xs">{{ level.description }}</p>
				</div>

				<div v-if="browsing && !level" class="flex flex-col gap-2" aria-busy="true">
					<span class="sr-only">Loading commands…</span>
					<USkeleton v-for="row in 8" :key="row" class="h-9 w-full" />
				</div>

				<ul v-else-if="level" class="flex flex-col gap-0.5" :aria-busy="browsing">
					<li v-for="group in level.groups" :key="group.name">
						<button type="button" :class="itemClass()" @click="openGroup(group.name)">
							<span class="flex min-w-0 items-center justify-between gap-2">
								<span class="text-highlighted truncate font-mono text-sm">{{
									lastWord(group.name)
								}}</span>
								<span class="text-dimmed flex shrink-0 items-center gap-1 text-xs tabular-nums">
									{{ formatNumber(group.count) }}
									<UIcon name="i-lucide-chevron-right" class="size-3.5" aria-hidden="true" />
								</span>
							</span>
							<span v-if="group.description" class="text-muted line-clamp-1 text-xs">{{
								group.description
							}}</span>
						</button>
					</li>
					<li v-for="item in level.commands" :key="item.command">
						<button type="button" :class="itemClass(item.command)" @click="emit('select', item.command)">
							<span class="flex min-w-0 items-center gap-2">
								<span class="text-highlighted truncate font-mono text-sm">{{
									lastWord(item.command)
								}}</span>
								<UBadge v-if="item.local" color="neutral" variant="outline" size="sm" label="Local" />
							</span>
							<span class="text-muted line-clamp-1 text-xs">{{ item.summary }}</span>
						</button>
					</li>
				</ul>
			</section>
		</template>
	</div>
</template>

<script setup>
import { useDebounceFn, useLocalStorage } from '@vueuse/core'

// Finds a cf command: search ranks them as `cf cli search` does, and browsing walks the same
// tree `cf <group> --help` prints. Emits `select` with the command's name.
const props = defineProps({
	selected: { type: String, default: '' }
})

const emit = defineEmits(['select'])

const RECENT_LIMIT = 8
const SEARCH_LIMIT = 25

const { search, browse } = useCfCommands()

const query = ref('')
const results = ref([])
const searching = ref(false)
const error = ref('')
const prefix = ref('')
const level = ref(null)
const browsing = ref(false)

const recent = useLocalStorage(STORAGE_KEYS.consoleRecent, [])

// Remembers commands as they're opened, most recent first.
watch(
	() => props.selected,
	(name) => {
		if (!name) return
		const list = Array.isArray(recent.value) ? recent.value : []
		recent.value = [name, ...list.filter((item) => item !== name)].slice(0, RECENT_LIMIT)
	},
	{ immediate: true }
)

let searchToken = 0
const runSearch = useDebounceFn(async () => {
	const text = query.value.trim()
	const token = ++searchToken
	if (!text) {
		results.value = []
		searching.value = false
		return
	}
	searching.value = true
	error.value = ''
	try {
		const found = await search(text, { limit: SEARCH_LIMIT })
		if (token === searchToken) results.value = found
	} catch (reason) {
		if (token === searchToken) error.value = describeError(reason, 'Try again in a moment.')
	} finally {
		if (token === searchToken) searching.value = false
	}
}, 150)

watch(query, (text) => {
	if (text.trim()) searching.value = true
	else error.value = ''
	runSearch()
})

const openGroup = async (name) => {
	prefix.value = name
	browsing.value = true
	error.value = ''
	try {
		const found = await browse(name)
		if (prefix.value === name) level.value = found
	} catch (reason) {
		if (prefix.value === name) error.value = describeError(reason, 'Try again in a moment.')
	} finally {
		if (prefix.value === name) browsing.value = false
	}
}

const retry = () => (query.value.trim() ? runSearch() : openGroup(prefix.value))

onMounted(() => openGroup(''))

const crumbs = computed(() => {
	const words = prefix.value ? prefix.value.split(' ') : []
	return words.map((word, index) => ({ word, prefix: words.slice(0, index + 1).join(' ') }))
})

const lastWord = (name) => name.split(' ').pop()

const itemClass = (name) => [
	'flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-start',
	'hover:bg-elevated focus-visible:outline-primary focus-visible:outline-2',
	name && name === props.selected ? 'bg-elevated' : ''
]

const liveStatus = computed(() => {
	if (!query.value.trim() || searching.value) return ''
	return results.value.length ? `${plural(results.value.length, 'command')} found` : 'No commands match'
})

const searchField = useTemplateRef('searchField')
const resultList = useTemplateRef('resultList')
const focusFirstResult = () => resultList.value?.querySelector('button')?.focus()

defineShortcuts({
	'/': () => searchField.value?.inputRef?.focus()
})

defineExpose({ focusSearch: () => searchField.value?.inputRef?.focus() })
</script>
