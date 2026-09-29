<template>
	<div v-if="blocks.length" class="flex flex-col gap-1.5">
		<div :id="bodyId" class="flex flex-col gap-2">
			<component :is="block" v-for="(block, index) in visibleBlocks" :key="index" />
		</div>
		<UButton
			v-if="collapsible"
			:label="expanded ? 'Show less' : 'Show more'"
			color="neutral"
			variant="link"
			size="xs"
			class="self-start px-0"
			:aria-expanded="expanded"
			:aria-controls="bodyId"
			@click="expanded = !expanded"
		/>
	</div>
</template>

<script setup>
// cf's help text comes from Cloudflare's API docs: paragraphs, `- ` lists, `###` headings,
// `code`, **bold** and [links](https://…). This renders those as elements rather than HTML
// strings, so nothing in the text can inject markup. Only http(s) links are made clickable.
const props = defineProps({
	text: { type: String, default: '' },
	// Lines of the first paragraph to show before "Show more"; 0 shows everything
	clamp: { type: Number, default: 0 }
})

const CLAMP_CLASSES = { 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' }
const INLINE = /(`[^`\n]+`)|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*\n]+)\*\*/g
// Roughly a line of help text at the widths the console uses.
const CHARS_PER_LINE = 90

const bodyId = useId()
const expanded = ref(false)

const inline = (text) => {
	const nodes = []
	let last = 0
	for (const match of text.matchAll(INLINE)) {
		if (match.index > last) nodes.push(text.slice(last, match.index))
		if (match[1]) {
			nodes.push(
				h('code', { class: 'bg-elevated rounded px-1 py-0.5 font-mono text-[0.85em]' }, match[1].slice(1, -1))
			)
		} else if (match[2]) {
			nodes.push(
				h(
					'a',
					{
						href: match[3],
						target: '_blank',
						rel: 'noopener noreferrer',
						class: 'text-primary hover:underline'
					},
					[match[2], h('span', { class: 'sr-only' }, ' (opens in a new tab)')]
				)
			)
		} else {
			nodes.push(h('strong', { class: 'text-highlighted font-medium' }, match[4]))
		}
		last = match.index + match[0].length
	}
	if (last < text.length) nodes.push(text.slice(last))
	return nodes
}

// Each block is { kind, text | items }, rendered by `render` with an optional extra class.
const parsed = computed(() => {
	const out = []
	let paragraph = []
	let list = []
	const flush = () => {
		if (paragraph.length) out.push({ kind: 'p', text: paragraph.join(' ') })
		if (list.length) out.push({ kind: 'ul', items: list })
		paragraph = []
		list = []
	}
	for (const raw of String(props.text || '').split('\n')) {
		const line = raw.trim()
		const heading = /^#{1,6}\s+(.*)$/.exec(line)
		const item = /^[-*]\s+(.*)$/.exec(line)
		if (!line) flush()
		else if (heading) {
			flush()
			out.push({ kind: 'heading', text: heading[1] })
		} else if (item) {
			if (paragraph.length) flush()
			list.push(item[1])
		} else {
			if (list.length) flush()
			paragraph.push(line)
		}
	}
	flush()
	return out
})

const render = (block, extraClass = '') => {
	if (block.kind === 'ul') {
		return () =>
			h(
				'ul',
				{ class: ['list-disc ps-5', extraClass] },
				block.items.map((item) => h('li', inline(item)))
			)
	}
	const headingClass = block.kind === 'heading' ? 'text-highlighted font-medium' : ''
	return () => h('p', { class: [headingClass, extraClass] }, inline(block.text))
}

const blocks = computed(() => parsed.value.map((block) => render(block)))
const clampClass = computed(() => CLAMP_CLASSES[props.clamp] || '')
const collapsible = computed(
	() =>
		Boolean(clampClass.value) &&
		(parsed.value.length > 1 || (parsed.value[0]?.text || '').length > props.clamp * CHARS_PER_LINE)
)
const visibleBlocks = computed(() =>
	collapsible.value && !expanded.value ? [render(parsed.value[0], clampClass.value)] : blocks.value
)
</script>
