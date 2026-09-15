<template>
	<div class="flex min-w-0 flex-col gap-4">
		<UAlert
			v-if="error"
			color="error"
			variant="subtle"
			icon="i-lucide-circle-alert"
			role="alert"
			:title="errorTitle"
			:description="error"
			:actions="[
				{
					label: 'Try again',
					icon: 'i-lucide-refresh-cw',
					color: 'neutral',
					variant: 'outline',
					loading,
					onClick: () => emit('retry')
				}
			]"
		/>

		<UTable
			v-if="!error || data.length"
			v-bind="$attrs"
			:data="data"
			:columns="columns"
			:loading="loading || !loaded"
			:caption="caption"
			sticky="header"
		>
			<template #loading>
				<div class="flex flex-col gap-3" role="status">
					<span class="sr-only">{{ loadingLabel }}</span>
					<USkeleton v-for="row in 4" :key="row" class="h-6 w-full" />
				</div>
			</template>

			<template #empty>
				<slot v-if="loaded && !error" name="empty" />
			</template>

			<template v-for="name in passthroughSlots" #[name]="slotProps">
				<slot :name="name" v-bind="slotProps || {}" />
			</template>
		</UTable>
	</div>
</template>

<script setup>
// A UTable with the states every account resource list needs: skeleton rows until the first
// load finishes, the loading bar (with rows still visible) while refreshing, Cloudflare's
// error with a retry, and the page's own empty state only once the list has really loaded.
// Columns, cell slots (#name-cell etc.) and other UTable props pass straight through.
defineOptions({ inheritAttrs: false })

defineProps({
	data: { type: Array, default: () => [] },
	columns: { type: Array, required: true },
	loading: { type: Boolean, default: false },
	loaded: { type: Boolean, default: false },
	error: { type: String, default: '' },
	errorTitle: { type: String, default: 'Couldn’t load the list' },
	// Read by screen readers only
	caption: { type: String, default: '' },
	loadingLabel: { type: String, default: 'Loading…' }
})

const emit = defineEmits(['retry'])
const slots = useSlots()

const passthroughSlots = computed(() => Object.keys(slots).filter((name) => name !== 'empty' && name !== 'loading'))
</script>
