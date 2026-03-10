<template>
	<UButton variant="outline" color="primary" icon="i-heroicons-sparkles" @click="open = true">
		AI DNS Editor
	</UButton>

	<UModal v-model:open="open">
		<template #title>
			<div class="flex items-center gap-2">
				<UIcon name="i-heroicons-sparkles" class="text-primary h-5 w-5" />
				<span>AI DNS Editor</span>
			</div>
		</template>

		<template #description>
			Paste raw DNS instructions for <span class="font-semibold">{{ zoneName || 'this zone' }}</span> and review
			the extracted records before anything is added.
		</template>

		<template #body>
			<div class="space-y-4">
				<div
					class="border-comet-200 bg-comet-50 dark:border-comet-700 dark:bg-comet-900/40 rounded-lg border p-4 text-sm"
				>
					<p class="font-medium">What works well here</p>
					<p class="text-comet-600 dark:text-comet-300 mt-1">
						Paste provider setup text, screenshots copied as text, or email snippets. The AI will extract
						standard DNS records and flag conflicts before you confirm.
					</p>
				</div>

				<UTextarea v-model="input" :rows="12" placeholder="Paste DNS instructions here..." class="w-full" />

				<div
					v-if="errorMessage"
					class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
				>
					{{ errorMessage }}
				</div>

				<div v-if="plan" class="space-y-4">
					<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
						<div
							v-for="stat in stats"
							:key="stat.label"
							class="border-comet-200 dark:border-comet-700 dark:bg-comet-900/40 rounded-lg border bg-white/70 p-3"
						>
							<div class="text-comet-500 text-xs">{{ stat.label }}</div>
							<div class="text-comet-900 dark:text-comet-100 text-lg font-semibold">{{ stat.value }}</div>
						</div>
					</div>

					<div class="border-comet-200 dark:border-comet-700 rounded-lg border p-4">
						<p class="text-sm font-medium">{{ plan.summary }}</p>
						<div v-if="plan.warnings?.length" class="mt-3 space-y-2">
							<p class="text-xs font-semibold tracking-wide text-amber-600 uppercase">Warnings</p>
							<div
								v-for="warning in plan.warnings"
								:key="warning"
								class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
							>
								{{ warning }}
							</div>
						</div>
					</div>

					<div class="max-h-[24rem] space-y-3 overflow-y-auto pr-1">
						<div
							v-for="record in plan.records"
							:key="`${record.action}:${record.type}:${record.name}:${record.content}:${record.priority ?? ''}`"
							class="border-comet-200 dark:border-comet-700 rounded-lg border p-4"
						>
							<div class="flex flex-wrap items-center gap-2">
								<UBadge :color="getActionColor(record.action)" variant="subtle" class="uppercase">
									{{ record.action }}
								</UBadge>
								<UBadge color="neutral" variant="outline" class="uppercase">
									{{ record.type }}
								</UBadge>
								<UBadge v-if="record.priority !== null" color="info" variant="outline">
									Priority {{ record.priority }}
								</UBadge>
							</div>

							<div class="mt-3 space-y-2 text-sm">
								<div>
									<p class="text-comet-500 text-xs tracking-wide uppercase">Name</p>
									<p class="font-medium">{{ record.displayName }}</p>
								</div>
								<div>
									<p class="text-comet-500 text-xs tracking-wide uppercase">Value</p>
									<p class="font-mono text-xs break-words">{{ record.content }}</p>
								</div>
								<div v-if="record.action === 'update' && record.existingContent">
									<p class="text-comet-500 text-xs tracking-wide uppercase">Current value</p>
									<p class="font-mono text-xs break-words">{{ record.existingContent }}</p>
								</div>
								<p class="text-comet-500 text-xs">{{ record.reason }}</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</template>

		<template #footer>
			<div class="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<UButton color="neutral" variant="ghost" @click="resetState">Clear</UButton>
				<div class="flex flex-col gap-3 sm:flex-row sm:justify-end">
					<UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
					<UButton :loading="analysisLoading" :disabled="!canAnalyze" variant="outline" @click="analyze">
						Analyze
					</UButton>
					<UButton :loading="applyLoading" :disabled="!canApply" color="success" @click="applyPlan">
						Apply {{ applyableCount }} change{{ applyableCount === 1 ? '' : 's' }}
					</UButton>
				</div>
			</div>
		</template>
	</UModal>
</template>

<script setup>
const props = defineProps({
	apiKey: {
		type: String,
		required: true
	},
	zoneId: {
		type: [String, Number],
		required: true
	},
	zoneName: {
		type: String,
		default: ''
	}
})

const emit = defineEmits(['applied'])

const toast = useToast()
const open = ref(false)
const input = ref('')
const plan = ref(null)
const errorMessage = ref('')
const analysisLoading = ref(false)
const applyLoading = ref(false)

const canAnalyze = computed(
	() => Boolean(props.apiKey && props.zoneId && props.zoneName && input.value.trim()) && !analysisLoading.value
)
const applyableRecords = computed(() =>
	(plan.value?.records || []).filter((record) => record.action === 'create' || record.action === 'update')
)
const applyableCount = computed(() => applyableRecords.value.length)
const canApply = computed(() => applyableCount.value > 0 && !applyLoading.value)
const stats = computed(() => {
	const counts = plan.value?.counts || { create: 0, update: 0, exists: 0, conflict: 0 }
	return [
		{ label: 'Create', value: counts.create || 0 },
		{ label: 'Update', value: counts.update || 0 },
		{ label: 'Already there', value: counts.exists || 0 },
		{ label: 'Conflicts', value: counts.conflict || 0 }
	]
})

const getActionColor = (action) => {
	if (action === 'create') return 'success'
	if (action === 'update') return 'warning'
	if (action === 'exists') return 'neutral'
	if (action === 'conflict') return 'error'
	return 'neutral'
}

const resetState = () => {
	input.value = ''
	plan.value = null
	errorMessage.value = ''
}

const analyze = async () => {
	errorMessage.value = ''
	analysisLoading.value = true

	try {
		const response = await $fetch('/api/ai_dns_editor/plan', {
			method: 'POST',
			body: {
				apiKey: props.apiKey,
				currZone: props.zoneId,
				zoneName: props.zoneName,
				input: input.value
			}
		})

		plan.value = response?.result || null
		if (!plan.value?.records?.length) {
			errorMessage.value = 'No standard DNS records were found in that paste.'
		}
	} catch (error) {
		plan.value = null
		errorMessage.value = error?.data?.statusMessage || error?.message || 'Failed to analyze DNS instructions'
	}
	analysisLoading.value = false
}

const applyPlan = async () => {
	if (!applyableRecords.value.length) return

	applyLoading.value = true
	errorMessage.value = ''

	try {
		const response = await $fetch('/api/ai_dns_editor/apply', {
			method: 'POST',
			body: {
				apiKey: props.apiKey,
				currZone: props.zoneId,
				changes: applyableRecords.value
			}
		})

		const result = response?.result || { created: 0, updated: 0, failed: 0 }
		if (result.failed > 0) {
			errorMessage.value = `${result.failed} change${result.failed === 1 ? '' : 's'} failed while applying.`
		}

		toast.add({
			id: `ai-dns-editor-${Date.now()}`,
			title: 'AI DNS changes applied',
			description: `${result.created} created, ${result.updated} updated${
				result.failed ? `, ${result.failed} failed` : ''
			}`,
			icon: 'i-clarity-check-circle-solid',
			duration: 3500,
			color: result.failed ? 'warning' : 'success'
		})

		emit('applied', result)
		if (!result.failed) {
			open.value = false
			resetState()
		}
	} catch (error) {
		errorMessage.value = error?.data?.statusMessage || error?.message || 'Failed to apply DNS changes'
	}

	applyLoading.value = false
}

watch(open, (value) => {
	if (value) return
	errorMessage.value = ''
})
</script>
