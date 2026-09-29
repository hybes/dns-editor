<template>
	<section :aria-labelledby="headingId" class="flex flex-col gap-2">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="flex min-w-0 flex-wrap items-center gap-2">
				<h3 :id="headingId" class="text-highlighted text-sm font-medium">{{ label }}</h3>
				<UBadge v-if="current" :color="meta.color" :icon="meta.icon" variant="subtle" size="sm">
					{{ meta.label }}
				</UBadge>
			</div>
			<UButton
				label="Check again"
				icon="i-lucide-refresh-cw"
				size="xs"
				color="neutral"
				variant="outline"
				:loading="loading"
				:aria-label="`Check the ${label.toLowerCase()} again`"
				@click="refresh"
			/>
		</div>

		<p v-if="loading && !current" class="text-muted text-sm">Checking with Cloudflare…</p>

		<template v-if="current">
			<p class="text-default text-sm">{{ meta.explanation }}</p>
			<p v-if="actionText" class="text-default text-sm">{{ actionText }}</p>
			<p v-if="confirmationSentTo" class="text-default text-sm">
				Cloudflare sent a confirmation to <span class="font-mono break-all">{{ confirmationSentTo }}</span
				>.
			</p>
			<p v-if="current.error?.message" class="text-error text-sm">
				{{ current.error.message }}
				<span v-if="current.error.code" class="text-dimmed font-mono text-xs">({{ current.error.code }})</span>
			</p>
			<p class="text-dimmed text-xs">
				<template v-if="formatDate(current.updated_at, 'datetime')">
					Updated
					<time :datetime="current.updated_at">{{ formatDate(current.updated_at, 'datetime') }}</time>
				</template>
				<template v-if="polling">
					{{ formatDate(current.updated_at, 'datetime') ? ' · ' : '' }}Checking again shortly
				</template>
			</p>
		</template>

		<p v-if="error" role="alert" class="text-error text-sm">Couldn’t check the status: {{ error }}</p>
		<p class="sr-only" role="status">{{ announcement }}</p>
	</section>
</template>

<script setup>
// The state of one Registrar workflow (a registration, transfer or update) from its
// get-*-status command, with a Check again button. With `poll`, it checks a few more times with
// growing gaps while the workflow is running, then stops; it never polls a workflow that is
// waiting on the person or on a third party, as Cloudflare's polling guidance asks.
const props = defineProps({
	account: { type: String, required: true },
	domain: { type: String, required: true },
	// cf command, such as 'registrar registrations get-registration-status'
	command: { type: String, required: true },
	// Heading, such as 'Registration'
	label: { type: String, default: 'Status' },
	// A status already in hand, such as the create response's; fetched when missing
	status: { type: Object, default: null },
	poll: { type: Boolean, default: false }
})

const emit = defineEmits(['update'])

// About 45 seconds in all. Anything slower gets a manual Check again.
const POLL_DELAYS_MS = [3000, 6000, 12000, 24000]

const STATES = {
	pending: {
		label: 'Queued',
		color: 'neutral',
		icon: 'i-lucide-clock',
		explanation: 'Cloudflare has queued it and will start shortly.'
	},
	in_progress: {
		label: 'In progress',
		color: 'info',
		icon: 'i-lucide-loader-circle',
		explanation: 'Cloudflare is working on it with the registry.'
	},
	action_required: {
		label: 'Needs you',
		color: 'warning',
		icon: 'i-lucide-hand',
		explanation: 'It’s paused until someone acts on it, and won’t carry on by itself.'
	},
	blocked: {
		label: 'Waiting on a third party',
		color: 'warning',
		icon: 'i-lucide-hourglass',
		explanation:
			'It’s waiting for the registry or another registrar to respond. It carries on by itself when they do, so check again later.'
	},
	succeeded: { label: 'Done', color: 'success', icon: 'i-lucide-circle-check', explanation: 'It finished.' },
	failed: {
		label: 'Failed',
		color: 'error',
		icon: 'i-lucide-circle-x',
		explanation: 'It didn’t finish. Review the reason before trying again.'
	}
}

const UNKNOWN_STATE = { label: 'Unknown', color: 'neutral', icon: 'i-lucide-circle-help', explanation: '' }

const { exec } = useCfCommands()
const headingId = useId()

const current = ref(props.status)
const loading = ref(false)
const error = ref('')
const announcement = ref('')
const polling = ref(false)

let pollIndex = 0
let timer = null
let token = 0

const meta = computed(() => {
	const state = current.value?.state
	if (STATES[state]) return STATES[state]
	return { ...UNKNOWN_STATE, explanation: state ? `Cloudflare reports “${state}”.` : '' }
})

const isFinished = (status) => status?.completed === true || ['succeeded', 'failed'].includes(status?.state)
// Waiting on the person or a third party: polling a few seconds apart won't change anything.
const isStalled = (status) => ['action_required', 'blocked'].includes(status?.state)

const describeValue = (value) => {
	if (typeof value === 'string') return value
	if (value && typeof value === 'object') {
		const text = value.description || value.message || value.type
		if (typeof text === 'string') return text
		return JSON.stringify(value)
	}
	return ''
}

const actionText = computed(() => {
	const action = describeValue(current.value?.context?.action)
	return action ? `What’s needed: ${action}` : ''
})

const confirmationSentTo = computed(() => {
	const value = current.value?.context?.confirmation_sent_to
	return typeof value === 'string' ? value : ''
})

const stopPolling = () => {
	clearTimeout(timer)
	timer = null
	polling.value = false
}

const schedule = () => {
	stopPolling()
	if (!props.poll || pollIndex >= POLL_DELAYS_MS.length) return
	if (!current.value || isFinished(current.value) || isStalled(current.value)) return
	polling.value = true
	timer = setTimeout(() => {
		pollIndex++
		load()
	}, POLL_DELAYS_MS[pollIndex])
}

const load = async () => {
	const id = ++token
	loading.value = true
	error.value = ''
	try {
		const response = await exec(
			props.command,
			{ account: props.account, args: { 'domain-name': props.domain } },
			{ fallback: 'Cloudflare didn’t return the status' }
		)
		if (id !== token) return
		const previous = current.value?.state
		current.value = response?.result || null
		if (current.value && current.value.state !== previous) {
			announcement.value = `${props.label}: ${meta.value.label}.`
		}
		emit('update', current.value)
	} catch (reason) {
		if (id !== token) return
		error.value = describeError(reason, 'Cloudflare didn’t return the status')
	} finally {
		if (id === token) {
			loading.value = false
			schedule()
		}
	}
}

const refresh = () => {
	stopPolling()
	load()
}

watch(
	() => [props.account, props.domain, props.command],
	() => {
		token++
		pollIndex = 0
		stopPolling()
		current.value = props.status
		error.value = ''
		loading.value = false
		if (current.value) schedule()
		else load()
	},
	{ immediate: true }
)

watch(
	() => props.status,
	(status) => {
		if (status && status !== current.value) {
			current.value = status
			schedule()
		}
	}
)

onBeforeUnmount(() => {
	token++
	stopPolling()
})
</script>
