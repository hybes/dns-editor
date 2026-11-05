<template>
	<div v-if="endpoint" class="flex flex-col gap-1.5">
		<cap-widget
			ref="widget"
			class="cap-check"
			:data-cap-api-endpoint="endpoint"
			data-cap-i18n-initial-state="I’m a person"
			data-cap-i18n-verifying-label="Checking…"
			data-cap-i18n-solved-label="Checked"
			data-cap-i18n-error-label="Check failed. Try again."
			:data-cap-i18n-verify-aria-label="VERIFY_LABEL"
			data-cap-i18n-verifying-aria-label="Checking you’re a person, please wait"
			data-cap-i18n-verified-aria-label="Checked, you can continue"
			data-cap-i18n-error-aria-label="The check failed. Select to try again"
			@solve="onSolve"
			@reset="onReset"
			@error="onError"
		/>
		<p v-if="error" class="text-error text-sm" role="alert">{{ error }}</p>
	</div>
</template>

<script setup>
// Cap's check on the sign-in and sign-up forms (see shared/utils/cap.js). The widget solves a
// small proof-of-work puzzle in the browser when it's selected. Submitting the form without
// selecting it runs the same check first, so it never has to be clicked. Each token works once:
// reset() after every submission, whatever the answer.
import '@cap.js/widget'
import { capEndpoint } from '#shared/utils/cap'
import { log, logText } from '#shared/utils/log'

defineProps({
	// The server's message when it refused the token
	error: { type: String, default: '' }
})

const token = defineModel({ type: String, default: '' })

const config = useRuntimeConfig()
const endpoint = capEndpoint(config.public)
const widget = useTemplateRef('widget')

// Give up waiting on a check that hasn't finished in this long and send the form without a
// token; the server decides (it lets it through only if Cap itself is down).
const SOLVE_TIMEOUT_MS = 30_000

const VERIFY_LABEL = 'Confirm you’re a person'

const onSolve = (event) => {
	token.value = event.detail?.token || ''
}

// Runs after a submission and when a token expires. The widget (0.1.58) puts its label back but
// leaves the button's aria-label saying it's checked, so screen readers would hear a stale state.
const onReset = () => {
	token.value = ''
	widget.value?.shadowRoot?.querySelector('[part="trigger"]')?.setAttribute('aria-label', VERIFY_LABEL)
}

// Codes about the visitor's own browser (WebAssembly or workers blocked, an automated browser)
// are expected; the rest mean Cap couldn't be reached or answered oddly.
const BROWSER_CODES = new Set(['wasm_load_failed', 'worker_spawn_failed', 'instr_blocked', 'instr_timeout'])

const onError = (event) => {
	token.value = ''
	const code = event.detail?.code || 'unknown'
	const level = BROWSER_CODES.has(code) ? 'info' : 'warn'
	log[level]('cap', logText`widget check failed (${code}): ${event.detail?.message}`, {
		code,
		endpoint,
		once: code
	})
}

// The token to send: the current one, or a fresh one from running the check now. Empty when
// Cap is off or the check failed.
const ready = () => {
	const element = widget.value
	if (!endpoint || !element) return Promise.resolve('')
	if (token.value) return Promise.resolve(token.value)
	return new Promise((resolve) => {
		const finish = (value) => {
			clearTimeout(timer)
			element.removeEventListener('solve', solved)
			element.removeEventListener('error', failed)
			resolve(value)
		}
		const solved = (event) => finish(event.detail?.token || '')
		const failed = () => finish('')
		const timer = setTimeout(() => finish(token.value), SOLVE_TIMEOUT_MS)
		element.addEventListener('solve', solved)
		element.addEventListener('error', failed)
		// Already running when the person selected the widget: the listeners above catch the end.
		Promise.resolve(element.solve?.()).catch(() => finish(''))
	})
}

const reset = () => {
	token.value = ''
	widget.value?.reset?.()
}

defineExpose({ ready, reset })
</script>

<style scoped>
.cap-check {
	display: block;
	--cap-widget-width: 100%;
	--cap-background: var(--ui-bg);
	--cap-border-color: var(--ui-border-accented);
	--cap-border-radius: calc(var(--ui-radius) * 2);
	--cap-color: var(--ui-text);
	--cap-checkbox-border: 1px solid var(--ui-border-accented);
	--cap-checkbox-background: var(--ui-bg-elevated);
	--cap-spinner-color: var(--ui-primary);
	--cap-spinner-background-color: var(--ui-border);
	--cap-focus-ring: var(--ui-primary);
	--cap-font: inherit;
}
</style>
