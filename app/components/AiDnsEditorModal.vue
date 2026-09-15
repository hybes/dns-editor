<template>
	<UModal
		v-model:open="open"
		title="AI editor"
		:description="`Paste DNS setup instructions for ${zoneName || 'this zone'}. Nothing changes until you review the plan and apply it.`"
		:dismissible="!applying"
		:close="!applying"
		:ui="{ content: 'sm:max-w-2xl' }"
	>
		<template #body>
			<div class="flex flex-col gap-4">
				<UFormField
					label="Instructions"
					name="ai-instructions"
					description="Setup text from a provider’s help page or email. A, AAAA, CNAME, MX and TXT records are picked up."
				>
					<UTextarea
						v-model="input"
						:rows="6"
						autoresize
						:maxrows="14"
						placeholder="Add a CNAME record for www that points to shops.example-host.net…"
						:disabled="analysing || applying"
						class="w-full"
					/>
				</UFormField>

				<UAlert
					v-if="notice"
					role="alert"
					:color="notice.color"
					variant="subtle"
					:icon="notice.icon"
					:title="notice.title"
					:description="notice.description"
				/>

				<section v-if="plan" aria-labelledby="ai-plan-heading" class="flex flex-col gap-3">
					<div>
						<h3 id="ai-plan-heading" class="text-highlighted text-sm font-semibold">Proposed changes</h3>
						<p v-if="plan.summary" class="text-default mt-1 text-sm">{{ plan.summary }}</p>
						<p class="text-muted mt-1 text-sm">{{ countsLabel }}</p>
					</div>

					<UAlert
						v-if="plan.warnings.length"
						color="warning"
						variant="subtle"
						icon="i-lucide-triangle-alert"
						title="Check these before applying"
					>
						<template #description>
							<ul class="list-disc space-y-1 ps-4">
								<li v-for="warning in plan.warnings" :key="warning">{{ warning }}</li>
							</ul>
						</template>
					</UAlert>

					<ul v-if="plan.records.length" class="divide-default border-default divide-y border-y">
						<li v-for="item in plan.records" :key="item.key" class="flex min-w-0 flex-col gap-1 py-3">
							<div class="flex min-w-0 flex-wrap items-center gap-2">
								<UBadge :color="ACTIONS[item.action]?.color || 'neutral'" variant="subtle" size="sm">
									{{ ACTIONS[item.action]?.label || item.action }}
								</UBadge>
								<UBadge
									:color="getRecordTypeColor(item.type)"
									variant="outline"
									size="sm"
									class="font-mono"
								>
									{{ item.type }}
								</UBadge>
								<span class="text-highlighted min-w-0 text-sm font-medium break-all">
									{{ item.displayName }}
								</span>
							</div>
							<p class="text-default font-mono text-xs break-all">
								<span v-if="item.priority !== null" class="text-muted">{{ item.priority }}&nbsp;</span
								>{{ item.content }}
							</p>
							<p v-if="item.action === 'update' && item.existingContent" class="text-muted text-xs">
								Replaces <span class="font-mono break-all">{{ item.existingContent }}</span>
							</p>
							<p class="text-muted text-xs">{{ item.reason }}</p>
							<p v-if="failures[item.key]" class="text-error flex items-start gap-1.5 text-xs">
								<UIcon name="i-lucide-circle-x" class="mt-px size-3.5 shrink-0" aria-hidden="true" />
								<span>Not applied: {{ failures[item.key] }}</span>
							</p>
						</li>
					</ul>
				</section>

				<section v-if="applied.length" aria-labelledby="ai-applied-heading" class="flex flex-col gap-2">
					<h3 id="ai-applied-heading" class="text-highlighted text-sm font-semibold">Applied</h3>
					<ul class="flex flex-col gap-1">
						<li v-for="item in applied" :key="item.key" class="flex min-w-0 items-center gap-2 text-sm">
							<UIcon
								name="i-lucide-circle-check"
								class="text-success size-4 shrink-0"
								aria-hidden="true"
							/>
							<span class="text-muted">{{ ACTIONS[item.action]?.done }}</span>
							<span class="text-default font-mono text-xs">{{ item.type }}</span>
							<span class="text-default min-w-0 truncate">{{ item.displayName }}</span>
						</li>
					</ul>
				</section>
			</div>
		</template>

		<template #footer>
			<div class="flex w-full flex-wrap items-center justify-between gap-2">
				<UButton
					v-if="input || plan"
					color="neutral"
					variant="ghost"
					label="Clear"
					:disabled="analysing || applying"
					@click="reset"
				/>
				<span v-else />
				<div class="flex flex-wrap justify-end gap-2">
					<UButton
						color="neutral"
						variant="ghost"
						:label="applied.length ? 'Close' : 'Cancel'"
						:disabled="applying"
						@click="open = false"
					/>
					<UButton
						:color="plan ? 'neutral' : 'primary'"
						:variant="plan ? 'outline' : 'solid'"
						:label="plan ? 'Analyse again' : 'Analyse'"
						:loading="analysing"
						:disabled="!canAnalyse"
						@click="analyse"
					/>
					<UButton
						v-if="plan"
						color="primary"
						:label="applyLabel"
						:loading="applying"
						:disabled="!canApply"
						@click="applyPlan"
					/>
				</div>
			</div>
		</template>
	</UModal>
</template>

<script setup>
const props = defineProps({
	zoneId: {
		type: String,
		required: true
	},
	zoneName: {
		type: String,
		default: ''
	}
})

const open = defineModel('open', { type: Boolean, default: false })

// Only create and update can be applied; the other actions are shown so nothing in the
// paste silently disappears.
const ACTIONS = {
	create: { label: 'Create', color: 'success', done: 'Created' },
	update: { label: 'Update', color: 'warning', done: 'Updated' },
	exists: { label: 'Already exists', color: 'neutral' },
	conflict: { label: 'Conflict', color: 'error' }
}

const { call } = useCfApi()
const notify = useNotify()
const { getRecordTypeColor } = useRecordTypes()
const zoneRecords = useZoneRecords(() => props.zoneId)

const input = ref('')
const plan = ref(null)
const failures = ref({})
const applied = ref([])
const notice = ref(null)
const analysing = ref(false)
const applying = ref(false)

const applyable = computed(() =>
	(plan.value?.records || []).filter((item) => item.action === 'create' || item.action === 'update')
)
const canAnalyse = computed(() => Boolean(props.zoneId && input.value.trim()) && !analysing.value && !applying.value)
const canApply = computed(() => applyable.value.length > 0 && !analysing.value && !applying.value)
const applyLabel = computed(() => `Apply ${plural(applyable.value.length, 'change')}`)

const countsLabel = computed(() => {
	const records = plan.value?.records || []
	const count = (action) => records.filter((item) => item.action === action).length
	const conflicts = count('conflict')
	const parts = [
		[count('create'), 'to create'],
		[count('update'), 'to update'],
		[count('exists'), 'already in the zone'],
		[conflicts, conflicts === 1 ? 'conflict' : 'conflicts']
	]
		.filter(([total]) => total > 0)
		.map(([total, label]) => `${formatNumber(total)} ${label}`)
	return parts.length ? parts.join(', ') : 'Nothing left to apply.'
})

const clearPlan = () => {
	plan.value = null
	failures.value = {}
	applied.value = []
	notice.value = null
}

const reset = () => {
	input.value = ''
	clearPlan()
}

// A plan belongs to the text it came from, so editing the text discards it.
watch(input, () => {
	if (plan.value || notice.value || applied.value.length) clearPlan()
})

// The zone can change while the modal is closed, so reopening starts from a fresh analysis.
watch(open, (isOpen) => {
	if (!isOpen && !applying.value) clearPlan()
})

const analyse = async () => {
	if (!canAnalyse.value) return
	const submitted = input.value
	analysing.value = true
	clearPlan()

	try {
		const response = await call(
			'ai_dns_editor/plan',
			{ currZone: props.zoneId, input: submitted },
			{ fallback: 'Couldn’t analyse the instructions' }
		)
		if (input.value !== submitted) return

		const result = response?.result || {}
		const records = (result.records || []).map((item, index) => ({
			...item,
			key: `${index}:${item.type}:${item.name}`
		}))

		if (!records.length) {
			notice.value = {
				color: 'warning',
				icon: 'i-lucide-search-x',
				title: 'No records found',
				description: result.warnings?.length
					? result.warnings.join(' ')
					: 'No A, AAAA, CNAME, MX or TXT records were found. Check the text includes record names and values.'
			}
			return
		}

		plan.value = { summary: result.summary || '', warnings: result.warnings || [], records }
	} catch (error) {
		if (input.value !== submitted) return
		notice.value = {
			color: 'error',
			icon: 'i-lucide-circle-alert',
			title: 'Couldn’t analyse the instructions',
			description: describeError(error, 'Try again in a moment.')
		}
	} finally {
		analysing.value = false
	}
}

const applyPlan = async () => {
	if (!canApply.value) return
	const changes = applyable.value
	applying.value = true
	notice.value = null

	let outcome = null
	try {
		const response = await call(
			'ai_dns_editor/apply',
			{ currZone: props.zoneId, changes },
			{ fallback: 'Couldn’t apply the changes' }
		)
		outcome = response?.result
	} catch (error) {
		// When some changes fail the route still reports every change's result.
		outcome = error?.response?.result || null
		if (!outcome?.results) {
			notice.value = {
				color: 'error',
				icon: 'i-lucide-circle-alert',
				title: 'No changes were applied',
				description: describeError(error, 'Try again in a moment.')
			}
			// The notice sits above the plan, which may be scrolled out of view.
			notify.error('No changes were applied', error, 'Try again in a moment.')
			applying.value = false
			return
		}
	}

	const resultsByKey = new Map((outcome?.results || []).map((item) => [item.key, item]))
	const succeeded = changes.filter((item) => resultsByKey.get(item.key)?.success)
	const failed = changes.filter((item) => !resultsByKey.get(item.key)?.success)
	const appliedKeys = new Set(succeeded.map((item) => item.key))

	// Applied changes leave the plan, so pressing Apply again only retries what failed.
	failures.value = Object.fromEntries(
		failed.map((item) => [
			item.key,
			resultsByKey.get(item.key)?.message || 'Cloudflare didn’t report a result for this change'
		])
	)
	applied.value = [...applied.value, ...succeeded]
	plan.value = { ...plan.value, records: plan.value.records.filter((item) => !appliedKeys.has(item.key)) }
	applying.value = false

	if (succeeded.length) zoneRecords.refresh()

	if (!failed.length) {
		notify.success(`Applied ${plural(succeeded.length, 'change')} to ${props.zoneName || 'this zone'}`)
		open.value = false
		reset()
		return
	}

	if (succeeded.length) {
		notify.warning(
			`Applied ${formatNumber(succeeded.length)} of ${formatNumber(changes.length)} changes`,
			`${plural(failed.length, 'change')} failed. The reasons are listed in the AI editor.`
		)
		return
	}

	notify.error(
		'No changes were applied',
		`Cloudflare rejected ${failed.length === 1 ? 'the change' : `all ${formatNumber(failed.length)} changes`}. The reasons are listed under each one.`
	)
}
</script>
