<template>
	<section :aria-labelledby="captionId" class="flex min-w-0 flex-col gap-3">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 :id="captionId" class="text-highlighted text-sm font-semibold">{{ title }}</h2>
			<UButton
				:label="showTable ? 'Show chart' : 'Show table'"
				:icon="showTable ? 'i-lucide-chart-column' : 'i-lucide-table-2'"
				color="neutral"
				variant="ghost"
				size="xs"
				@click="showTable = !showTable"
			/>
		</div>

		<div
			v-show="!showTable"
			ref="container"
			class="relative transition-opacity"
			:class="refreshing ? 'opacity-60' : ''"
			:style="{ height: `${HEIGHT}px` }"
		>
			<div
				v-if="width > 0"
				class="focus-visible:outline-primary absolute inset-0 touch-pan-y rounded-md focus-visible:outline-2 focus-visible:outline-offset-4"
				tabindex="0"
				role="slider"
				aria-orientation="horizontal"
				:aria-labelledby="captionId"
				:aria-describedby="hintId"
				:aria-valuemin="0"
				:aria-valuemax="Math.max(points.length - 1, 0)"
				:aria-valuenow="keyboardIndex ?? Math.max(points.length - 1, 0)"
				:aria-valuetext="valueText || undefined"
				@keydown="onKeydown"
				@focus="onFocus"
				@blur="onBlur"
				@pointermove="onPointer"
				@pointerdown="onPointer"
				@pointerleave="onPointerLeave"
			>
				<svg
					:width="width"
					:height="HEIGHT"
					:viewBox="`0 0 ${width} ${HEIGHT}`"
					class="block"
					aria-hidden="true"
				>
					<g v-for="tick in yTicks" :key="tick.value">
						<line
							:x1="plotLeft"
							:x2="plotRight"
							:y1="tick.y"
							:y2="tick.y"
							class="stroke-(--ui-border)"
							shape-rendering="crispEdges"
						/>
						<!-- v-text keeps template whitespace out of the label, which would shift end-anchored text. -->
						<text
							:x="plotLeft - 8"
							:y="tick.y"
							dy="0.32em"
							text-anchor="end"
							class="text-muted fill-current text-xs tabular-nums"
							v-text="tick.label"
						/>
					</g>

					<rect
						v-if="activeIndex !== null"
						:x="plotLeft + activeIndex * slot"
						:y="PLOT_TOP"
						:width="slot"
						:height="plotHeight"
						class="fill-(--ui-bg-accented)"
					/>

					<path v-for="bar in bars" :key="bar.key" :d="bar.d" class="fill-primary-600" />

					<line
						:x1="plotLeft"
						:x2="plotRight"
						:y1="baselineY"
						:y2="baselineY"
						class="stroke-(--ui-border-accented)"
						shape-rendering="crispEdges"
					/>

					<text
						v-for="label in xLabels"
						:key="label.key"
						:x="label.x"
						:y="HEIGHT - 8"
						:text-anchor="label.anchor"
						class="text-muted fill-current text-xs tabular-nums"
						v-text="label.text"
					/>
				</svg>
			</div>

			<div
				v-if="activePoint"
				class="bg-default ring-default pointer-events-none absolute z-10 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap shadow-sm ring"
				:style="tooltipStyle"
				aria-hidden="true"
			>
				<p class="text-highlighted text-sm font-semibold tabular-nums">{{ countLabel(activePoint.count) }}</p>
				<p class="text-muted">{{ fullLabel(activePoint.time) }}</p>
			</div>
		</div>

		<p :id="hintId" class="sr-only">
			Use the left and right arrow keys to read each {{ granularity === 'hour' ? 'hour' : 'day' }}, or show the
			table.
		</p>

		<UTable
			v-if="showTable"
			:data="points"
			:columns="columns"
			sticky
			class="max-h-80"
			:ui="{ th: 'px-3 py-2', td: 'px-3 py-2' }"
		>
			<template #time-cell="{ row }">
				<time :datetime="row.original.time">{{ fullLabel(row.original.time) }}</time>
			</template>
			<template #count-cell="{ row }">
				{{ formatNumber(row.original.count) }}
			</template>
		</UTable>
	</section>
</template>

<script setup>
import { useElementSize } from '@vueuse/core'

// One series of query counts per time bucket, drawn as thin columns. The table view
// carries every value, so the tooltip only ever adds convenience.
const props = defineProps({
	// [{ time: 'YYYY-MM-DD' | ISO hour, count }], oldest first, with empty buckets as zero.
	points: { type: Array, required: true },
	granularity: { type: String, default: 'day' },
	title: { type: String, required: true },
	refreshing: { type: Boolean, default: false }
})

const HEIGHT = 240
const PLOT_TOP = 12
const AXIS_BAND = 28
const BAR_MAX = 24
const BAR_GAP = 2
const RADIUS = 4
const CHAR_WIDTH = 7

const captionId = useId()
const hintId = useId()
const container = ref(null)
const { width: measuredWidth } = useElementSize(container)
const width = computed(() => Math.floor(measuredWidth.value))

const showTable = ref(false)
const pointerIndex = ref(null)
const keyboardIndex = ref(null)
const focused = ref(false)

const compactFormat = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 })
const dayShort = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' })
const hourShort = new Intl.DateTimeFormat(LOCALE, {
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
	timeZone: 'UTC'
})
const dayLong = new Intl.DateTimeFormat(LOCALE, {
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC'
})
const hourLong = new Intl.DateTimeFormat(LOCALE, {
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
	timeZone: 'UTC'
})

const toMs = (time) => Date.parse(props.granularity === 'hour' ? time : `${time}T00:00:00Z`)
const shortLabel = (time) => (props.granularity === 'hour' ? hourShort : dayShort).format(toMs(time))
const fullLabel = (time) =>
	props.granularity === 'hour' ? `${hourLong.format(toMs(time))} UTC` : dayLong.format(toMs(time))
const countLabel = (count) => plural(count, 'query', 'queries')

const columns = computed(() => [
	{ accessorKey: 'time', header: props.granularity === 'hour' ? 'Hour (UTC)' : 'Date (UTC)' },
	{ accessorKey: 'count', header: 'Queries', meta: { class: { th: 'text-end', td: 'text-end tabular-nums' } } }
])

// Rounds the axis to 1, 2 or 5 times a power of ten so tick labels stay readable.
const niceStep = (raw) => {
	const power = 10 ** Math.floor(Math.log10(raw))
	const unit = raw / power
	return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power
}

const scale = computed(() => {
	const max = props.points.reduce((highest, point) => Math.max(highest, point.count), 0)
	const step = max > 0 ? Math.max(1, niceStep(max / 4)) : 1
	return { step, top: Math.max(step, Math.ceil(max / step) * step) }
})

const plotBottom = HEIGHT - AXIS_BAND
const plotHeight = plotBottom - PLOT_TOP
const baselineY = plotBottom + 0.5

const yTicks = computed(() => {
	const { step, top } = scale.value
	const format = top >= 10_000 ? (value) => compactFormat.format(value) : formatNumber
	const ticks = []
	for (let value = 0; value <= top; value += step) {
		ticks.push({ value, label: format(value), y: Math.round(plotBottom - (value / top) * plotHeight) + 0.5 })
	}
	return ticks
})

const plotLeft = computed(() => Math.max(...yTicks.value.map((tick) => tick.label.length)) * CHAR_WIDTH + 12)
const plotRight = computed(() => width.value - 1)
const slot = computed(() => (props.points.length ? (plotRight.value - plotLeft.value) / props.points.length : 0))
const barWidth = computed(() => Math.max(1, Math.min(BAR_MAX, slot.value - BAR_GAP)))
const columnCenter = (index) => plotLeft.value + index * slot.value + slot.value / 2

// Rounded data end, square at the baseline.
const barPath = (x, y, w, h) => {
	const r = Math.min(RADIUS, w / 2, h)
	return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`
}

const bars = computed(() =>
	props.points
		.map((point, index) => {
			if (!point.count) return null
			// A non-zero bucket keeps a 1px sliver so it never reads as empty.
			const h = Math.max(1, (point.count / scale.value.top) * plotHeight)
			const x = columnCenter(index) - barWidth.value / 2
			return { key: point.time, d: barPath(x, plotBottom - h, barWidth.value, h) }
		})
		.filter(Boolean)
)

// Labels are anchored on the newest bucket and spaced so they never collide.
const xLabels = computed(() => {
	const count = props.points.length
	if (!count || width.value <= 0) return []
	const labelWidth = props.granularity === 'hour' ? 44 : 56
	const room = Math.max(1, Math.floor((plotRight.value - plotLeft.value) / labelWidth))
	const step = Math.ceil(count / room)
	const labels = []
	for (let index = count - 1; index >= 0; index -= step) {
		const center = columnCenter(index)
		let anchor = 'middle'
		let x = center
		if (center + labelWidth / 2 > width.value) {
			anchor = 'end'
			x = width.value
		} else if (center - labelWidth / 2 < plotLeft.value - 8) {
			anchor = 'start'
			x = plotLeft.value
		}
		labels.push({ key: props.points[index].time, text: shortLabel(props.points[index].time), x, anchor })
	}
	return labels
})

const activeIndex = computed(() => pointerIndex.value ?? (focused.value ? keyboardIndex.value : null))
const activePoint = computed(() => (activeIndex.value === null ? null : props.points[activeIndex.value] || null))

// The tooltip sits beside the hovered column so it never hides the bar being read.
const tooltipStyle = computed(() => {
	const center = columnCenter(activeIndex.value)
	const offset = slot.value / 2 + 8
	const side =
		center < width.value / 2 ? { left: `${center + offset}px` } : { right: `${width.value - center + offset}px` }
	return { top: `${PLOT_TOP}px`, ...side }
})

// The slider's spoken value. It doesn't depend on focus, so browse-mode reading and the
// first focus announcement name the newest bucket rather than a bare index.
const valueText = computed(() => {
	const point = props.points[keyboardIndex.value ?? props.points.length - 1]
	return point ? `${fullLabel(point.time)}: ${countLabel(point.count)}` : ''
})

// Touch pointers leave straight after lifting, which would hide the tooltip the tap just
// opened; tapping elsewhere blurs the chart and clears it instead.
const onPointerLeave = (event) => {
	if (event.pointerType !== 'touch') pointerIndex.value = null
}

const onBlur = () => {
	focused.value = false
	pointerIndex.value = null
}

const onPointer = (event) => {
	const x = event.clientX - event.currentTarget.getBoundingClientRect().left
	if (!props.points.length || x < plotLeft.value || x > plotRight.value) {
		pointerIndex.value = null
		return
	}
	pointerIndex.value = Math.min(props.points.length - 1, Math.floor((x - plotLeft.value) / slot.value))
}

const onFocus = () => {
	focused.value = true
	if (keyboardIndex.value === null && props.points.length) keyboardIndex.value = props.points.length - 1
}

const onKeydown = (event) => {
	const last = props.points.length - 1
	if (last < 0) return
	const current = keyboardIndex.value ?? last
	const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: last }[event.key]
	if (next === undefined) return
	event.preventDefault()
	keyboardIndex.value = Math.min(last, Math.max(0, next))
}

watch(
	() => props.points.length,
	() => {
		pointerIndex.value = null
		keyboardIndex.value = null
	}
)
</script>
