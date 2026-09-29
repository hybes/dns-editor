<template>
	<section aria-labelledby="console-output-heading" class="flex min-w-0 flex-col gap-3">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 id="console-output-heading" class="text-highlighted text-base font-semibold">
				{{ dryRun ? 'Dry run' : 'Result' }}
			</h2>
			<div class="flex flex-wrap items-center gap-1">
				<UButton
					v-if="nextPage"
					:label="nextPage.label"
					icon="i-lucide-chevron-right"
					size="sm"
					color="neutral"
					variant="outline"
					:loading="running"
					@click="emit('page', nextPage)"
				/>
				<UButton
					v-if="raw"
					label="Download"
					icon="i-lucide-download"
					size="sm"
					color="neutral"
					variant="ghost"
					@click="downloadRaw"
				/>
				<UButton
					label="Copy"
					icon="i-lucide-copy"
					size="sm"
					color="neutral"
					variant="ghost"
					:disabled="!shownText"
					@click="notify.copy(shownText, tabLabel)"
				/>
			</div>
		</div>

		<p class="sr-only" role="status">{{ statusText }}</p>

		<UAlert v-if="failed" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="errorTitle">
			<template #description>
				<ul class="flex flex-col gap-1">
					<li v-for="(error, index) in errors" :key="index">
						<span v-if="error.code" class="font-mono">[{{ error.code }}]</span>
						{{ error.message }}
					</li>
				</ul>
			</template>
		</UAlert>

		<p v-else-if="dryRun" class="text-muted text-sm">
			Nothing was sent to Cloudflare. This is the request {{ runLabel }} would send, as
			<code class="font-mono">--dry-run</code> shows it.
		</p>
		<p v-else class="text-muted text-sm">{{ successText }}</p>

		<ul v-if="messages.length" class="text-muted flex flex-col gap-1 text-sm">
			<li v-for="(message, index) in messages" :key="index" class="flex items-start gap-1.5">
				<UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0" />
				<span>{{ message }}</span>
			</li>
		</ul>

		<UTabs
			v-if="tabs.length > 1"
			v-model="tab"
			:items="tabs"
			variant="link"
			size="sm"
			:content="false"
			class="w-full"
		/>

		<pre
			v-if="shownText"
			class="bg-muted text-default max-h-[36rem] overflow-auto rounded-md p-3 font-mono text-xs break-all whitespace-pre-wrap"
			:aria-label="tabLabel"
			tabindex="0"
			>{{ shownText }}</pre>
		<p v-else-if="tab === 'output' && rawFile" class="text-muted text-sm">
			Cloudflare returned a {{ rawFile.contentType || 'binary' }} file. Download it to open it.
		</p>
	</section>
</template>

<script setup>
// What a console run produced, in three views: what cf would print (the unwrapped `result`,
// just the array for lists), Cloudflare's whole response, and the request that was sent.
const props = defineProps({
	// Cloudflare's envelope with `request` added by /api/cf/run
	response: { type: Object, required: true },
	command: { type: Object, required: true },
	dryRun: { type: Boolean, default: false },
	running: { type: Boolean, default: false }
})

const emit = defineEmits(['page'])
const notify = useNotify()

const tab = ref('output')

const failed = computed(() => props.response?.success === false)
const result = computed(() => props.response?.result)
const raw = computed(() =>
	props.command.output === 'raw' && result.value && typeof result.value === 'object' ? result.value : null
)
const rawFile = computed(() => (raw.value && typeof raw.value.base64 === 'string' ? raw.value : null))

const errors = computed(() =>
	(props.response?.errors || []).flatMap((error) => [
		{ code: error?.code, message: error?.message || String(error) },
		...(error?.error_chain || []).map((link) => ({ code: link?.code, message: link?.message || '' }))
	])
)
const messages = computed(() =>
	(props.response?.messages || [])
		.map((message) => (typeof message === 'string' ? message : message?.message))
		.filter(Boolean)
)

const runLabel = computed(() => `cf ${props.command.command}`)
const errorTitle = computed(() =>
	errors.value.length ? 'Cloudflare returned an error' : 'The request didn’t go through'
)

const json = (value) => JSON.stringify(value, null, 2)

// cf prints `result` alone, and nothing at all when a change returns no data.
const outputText = computed(() => {
	if (failed.value) return ''
	if (raw.value) return typeof raw.value.text === 'string' ? raw.value.text : ''
	if (result.value === null || result.value === undefined) return ''
	return json(result.value)
})

const responseText = computed(() => {
	const { request: _request, dryRun: _dryRun, ...envelope } = props.response || {}
	return json(envelope)
})
const requestText = computed(() => (props.response?.request ? json(props.response.request) : ''))

const tabs = computed(() => {
	if (props.dryRun) return [{ label: 'Request', value: 'request' }]
	return [
		{ label: 'Output', value: 'output' },
		{ label: 'Response', value: 'response' },
		{ label: 'Request', value: 'request' }
	]
})

watch(
	() => [props.response, props.dryRun],
	() => {
		tab.value = props.dryRun ? 'request' : failed.value ? 'response' : 'output'
	},
	{ immediate: true }
)

const shownText = computed(() => {
	if (tab.value === 'request') return requestText.value
	if (tab.value === 'response') return responseText.value
	return outputText.value
})
const tabLabel = computed(() => tabs.value.find((item) => item.value === tab.value)?.label || 'Output')

const info = computed(() => props.response?.result_info || null)

const successText = computed(() => {
	if (raw.value) return rawFile.value ? 'Cloudflare returned a file.' : 'Cloudflare returned text.'
	if (Array.isArray(result.value)) {
		const total = Number(info.value?.total_count)
		const shown = plural(result.value.length, 'item')
		return Number.isFinite(total) && total > result.value.length
			? `${shown} of ${formatNumber(total)}.`
			: `${shown}.`
	}
	if (result.value === null || result.value === undefined) return 'Done. Cloudflare returned no data.'
	return 'Done.'
})

const statusText = computed(() => {
	if (props.dryRun) return 'Dry run ready'
	return failed.value ? `${errorTitle.value}: ${errors.value[0]?.message || ''}` : successText.value
})

// cf lists one page at a time; offer the next one with the flag that asks for it.
const flagNames = computed(() => new Set((props.command.flags || []).map((flag) => flag.name)))
const nextPage = computed(() => {
	if (props.dryRun || failed.value || !info.value) return null
	const page = Number(info.value.page)
	const pages = Number(info.value.total_pages)
	if (flagNames.value.has('page') && page && pages && page < pages) {
		return { flag: 'page', value: page + 1, label: `Page ${formatNumber(page + 1)} of ${formatNumber(pages)}` }
	}
	const cursor = info.value.cursor || info.value.cursors?.after
	if (flagNames.value.has('cursor') && cursor) return { flag: 'cursor', value: cursor, label: 'Next page' }
	return null
})

const downloadRaw = () => {
	const file = raw.value
	if (!file) return
	const content =
		typeof file.base64 === 'string' ? Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0)) : file.text
	const url = URL.createObjectURL(new Blob([content], { type: file.contentType || 'application/octet-stream' }))
	const link = document.createElement('a')
	link.href = url
	link.download = props.command.command.replace(/\s+/g, '-')
	document.body.append(link)
	link.click()
	link.remove()
	// Revoking in the same tick can cancel the download in some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 0)
}
</script>
