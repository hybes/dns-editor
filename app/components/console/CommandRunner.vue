<template>
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-8">
		<header class="flex flex-col gap-3">
			<div class="flex min-w-0 items-start justify-between gap-2">
				<h1 class="text-highlighted min-w-0 font-mono text-lg font-semibold break-words">
					cf {{ command.command }}
				</h1>
				<UButton
					icon="i-lucide-copy"
					color="neutral"
					variant="ghost"
					size="sm"
					:aria-label="`Copy the command name cf ${command.command}`"
					@click="notify.copy(`cf ${command.command}`, 'Command')"
				/>
			</div>
			<p class="text-default">{{ command.summary }}</p>
			<dl v-if="!command.local" class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
				<div class="flex min-w-0 items-center gap-2">
					<dt class="sr-only">API request</dt>
					<dd class="flex min-w-0 items-center gap-2">
						<UBadge :color="methodColor" variant="subtle" class="font-mono">{{ command.method }}</UBadge>
						<code class="text-muted font-mono text-xs break-all">{{ command.path }}</code>
					</dd>
				</div>
				<div class="flex items-center gap-1.5">
					<dt class="text-muted">Acts on</dt>
					<dd class="text-default">{{ scopeLabel }}</dd>
				</div>
			</dl>
			<ConsoleHelpText
				v-if="command.description && command.description !== command.summary"
				:text="command.description"
				:clamp="4"
				class="text-muted text-sm"
			/>
		</header>

		<UAlert
			v-if="guided"
			color="neutral"
			variant="subtle"
			icon="i-lucide-info"
			:title="guided.title"
			:description="guided.description"
			:actions="[{ label: guided.label, to: guided.to, color: 'neutral', variant: 'outline' }]"
		/>

		<UAlert
			v-if="command.local"
			color="neutral"
			variant="subtle"
			icon="i-lucide-laptop"
			:title="`cf ${command.command} runs on your own machine`"
		>
			<template #description>
				<p>{{ localExplanation }}</p>
				<p class="mt-2">
					Install cf with <code class="font-mono">npm i -g cf</code>, then run
					<code class="font-mono">cf {{ command.command }} --help</code> in a terminal.
				</p>
			</template>
		</UAlert>

		<form v-else ref="formRoot" class="flex flex-col gap-8" novalidate @submit.prevent="requestRun(false)">
			<section v-if="scopeControls" aria-labelledby="console-target-heading" class="flex flex-col gap-4">
				<h2 id="console-target-heading" class="text-highlighted text-base font-semibold">Runs against</h2>

				<URadioGroup
					v-if="command.scope === 'accountOrZone'"
					v-model="target"
					:items="TARGET_ITEMS"
					orientation="horizontal"
					legend="Account or zone"
					:ui="{ legend: 'sr-only' }"
				/>

				<UFormField
					v-if="onZone"
					label="Zone"
					name="console-zone"
					required
					:error="fieldErrors.zone || false"
					:description="zonesError ? `Couldn’t load your zones: ${zonesError}` : ''"
				>
					<USelectMenu
						v-model="zoneId"
						:items="zoneItems"
						value-key="value"
						:loading="zonesLoading && !zoneItems.length"
						:search-input="{ placeholder: 'Find a zone…' }"
						:virtualize="zoneItems.length > 100"
						placeholder="Choose a zone"
						icon="i-lucide-globe"
						class="w-full"
					/>
				</UFormField>

				<UFormField
					v-if="usesAccount"
					label="Account"
					name="console-account"
					required
					:error="fieldErrors.account || false"
					:description="
						accountsError
							? `Couldn’t load your accounts: ${accountsError}`
							: 'cf reads this from CLOUDFLARE_ACCOUNT_ID.'
					"
				>
					<USelectMenu
						:model-value="accountId"
						:items="accountItems"
						value-key="value"
						:loading="accountsLoading && !accountItems.length"
						:search-input="accountItems.length > 8 ? { placeholder: 'Find an account…' } : false"
						placeholder="Choose an account"
						icon="i-lucide-building-2"
						class="w-full"
						@update:model-value="chooseAccount"
					/>
				</UFormField>
			</section>

			<section v-if="command.args.length" aria-labelledby="console-args-heading" class="flex flex-col gap-4">
				<h2 id="console-args-heading" class="text-highlighted text-base font-semibold">Arguments</h2>
				<ConsoleFlagField
					v-for="arg in command.args"
					:key="arg.name"
					v-model="values[arg.name]"
					:input="arg"
					positional
					:error="fieldErrors[arg.name]"
				/>
			</section>

			<section v-if="requiredFlags.length" aria-labelledby="console-required-heading" class="flex flex-col gap-4">
				<h2 id="console-required-heading" class="text-highlighted text-base font-semibold">Required options</h2>
				<p v-if="bodyReplacesFlags && requiredBodyFlags.length" class="text-muted -mt-2 text-sm">
					Not needed when you enter the request body as JSON below.
				</p>
				<ConsoleFlagField
					v-for="flag in requiredFlags"
					:key="flag.name"
					v-model="values[flag.name]"
					:input="flag"
					:error="fieldErrors[flag.name]"
				/>
			</section>

			<section v-if="optionalFlags.length" aria-labelledby="console-options-heading" class="flex flex-col gap-4">
				<UCollapsible v-model:open="optionsOpen" class="flex flex-col gap-4">
					<UButton
						color="neutral"
						variant="link"
						trailing-icon="i-lucide-chevron-down"
						class="group text-highlighted self-start px-0 text-base font-semibold"
						:ui="{ trailingIcon: 'transition-transform duration-200 group-data-[state=open]:rotate-180' }"
					>
						<span id="console-options-heading">Options</span>
						<span class="text-muted font-normal tabular-nums">
							{{
								setOptionalCount
									? `${setOptionalCount} of ${optionalFlags.length} set`
									: optionalFlags.length
							}}
						</span>
					</UButton>
					<template #content>
						<div class="flex flex-col gap-4">
							<UFormField
								v-if="optionalFlags.length > FILTER_FROM"
								label="Filter options"
								name="console-option-filter"
								:ui="{ labelWrapper: 'sr-only' }"
							>
								<UInput
									v-model="optionFilter"
									type="search"
									icon="i-lucide-list-filter"
									placeholder="Filter options"
									autocomplete="off"
									class="w-full"
								/>
							</UFormField>
							<ConsoleFlagField
								v-for="flag in filteredOptionalFlags"
								:key="flag.name"
								v-model="values[flag.name]"
								:input="flag"
								:error="fieldErrors[flag.name]"
							/>
							<p v-if="!filteredOptionalFlags.length" class="text-muted text-sm">
								No options match “{{ optionFilter.trim() }}”.
							</p>
						</div>
					</template>
				</UCollapsible>
			</section>

			<section v-if="fileFields.length" aria-labelledby="console-files-heading" class="flex flex-col gap-4">
				<h2 id="console-files-heading" class="text-highlighted text-base font-semibold">Files</h2>
				<UFormField
					v-for="field in fileFields"
					:key="field.field"
					:label="`--file (${field.field})`"
					:name="`console-file-${field.field}`"
					:error="fieldErrors[`file:${field.field}`] || false"
					:ui="{ label: 'font-mono text-sm' }"
				>
					<UFileUpload
						:model-value="fileInputs[field.field] || null"
						label="Drop a file here"
						description="or choose one from your device"
						layout="list"
						icon="i-lucide-file-up"
						class="min-h-24 w-full"
						@update:model-value="(file) => setFile(field.field, file)"
					/>
				</UFormField>
			</section>

			<section v-if="takesBody" aria-labelledby="console-body-heading" class="flex flex-col gap-4">
				<UFormField
					name="console-body"
					:required="bodyRequired"
					:error="fieldErrors.body || false"
					:description="bodyHelp"
					:ui="{ label: 'font-mono text-sm' }"
				>
					<template #label><span id="console-body-heading">--body</span></template>
					<template #hint>{{ command.bodyKind === 'json' ? 'Body · JSON' : 'Body' }}</template>
					<UTextarea
						v-model="bodyText"
						:rows="6"
						autoresize
						:maxrows="24"
						:placeholder="command.bodyKind === 'json' ? '{ … }' : ''"
						spellcheck="false"
						autocapitalize="off"
						autocomplete="off"
						class="w-full"
						:ui="{ base: 'font-mono text-xs' }"
					/>
				</UFormField>
			</section>

			<section aria-labelledby="console-line-heading" class="flex flex-col gap-3">
				<div class="flex items-center justify-between gap-2">
					<h2 id="console-line-heading" class="text-highlighted text-base font-semibold">Command</h2>
					<UButton
						label="Copy"
						icon="i-lucide-copy"
						size="sm"
						color="neutral"
						variant="ghost"
						@click="notify.copy(commandLine, 'Command')"
					/>
				</div>
				<pre
					class="bg-muted text-default overflow-x-auto rounded-md p-3 font-mono text-xs break-all whitespace-pre-wrap"
					>{{ commandLine }}</pre>

				<UAlert
					v-if="inputError"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					role="alert"
					title="Check the command"
					:description="inputError"
				/>

				<div class="flex flex-wrap items-center justify-end gap-2">
					<p class="text-dimmed me-auto hidden text-xs sm:block">
						<UKbd value="meta" /> <UKbd value="enter" /> to run
					</p>
					<UButton
						label="Dry run"
						icon="i-lucide-eye"
						color="neutral"
						variant="outline"
						:loading="running && lastRunDry"
						:disabled="running"
						@click="requestRun(true)"
					/>
					<UButton
						type="submit"
						:label="destructive ? 'Run…' : 'Run'"
						icon="i-lucide-play"
						:color="destructive ? 'error' : 'primary'"
						:loading="running && !lastRunDry"
						:disabled="running"
					/>
				</div>
			</section>
		</form>

		<div ref="outputRoot">
			<ConsoleOutput
				v-if="response"
				:response="response"
				:command="command"
				:dry-run="responseDry"
				:running="running"
				@page="nextPage"
			/>
		</div>

		<UModal
			v-model:open="confirmOpen"
			:title="`Run cf ${command.command}?`"
			:description="confirmDescription"
			:dismissible="!running"
			:close="!running"
		>
			<template #body>
				<pre
					class="bg-muted text-default overflow-x-auto rounded-md p-3 font-mono text-xs break-all whitespace-pre-wrap"
					>{{ commandLine }}</pre>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						label="Cancel"
						color="neutral"
						variant="ghost"
						:disabled="running"
						@click="confirmOpen = false"
					/>
					<UButton
						label="Run command"
						icon="i-lucide-play"
						color="error"
						:loading="running"
						@click="confirmRun"
					/>
				</div>
			</template>
		</UModal>
	</div>
</template>

<script setup>
// One cf command as a form: its help, its arguments and flags, the equivalent cf command
// line, and a run or dry run through /api/cf/run. Mirrors how cf reads its input: flags go
// where the catalogue says, --body replaces the body flags, and commands cf asks to confirm
// (or that delete) ask here too.
const props = defineProps({
	// /api/cf/command's result
	command: { type: Object, required: true },
	// Starting zone, such as the one the sidebar last showed
	initialZoneId: { type: String, default: '' }
})

const TARGET_ITEMS = [
	{ label: 'Account', value: 'account' },
	{ label: 'Zone', value: 'zone' }
]
const SCOPE_LABELS = {
	zone: 'A zone',
	account: 'An account',
	accountOrZone: 'An account or a zone',
	none: 'Your user or Cloudflare as a whole'
}
const METHOD_COLORS = { GET: 'info', POST: 'success', PUT: 'warning', PATCH: 'warning', DELETE: 'error' }
const LOCAL_NOTES = {
	'cli search': 'The search box on this page is cf cli search: it ranks commands the same way.',
	schema: 'Each command here shows what cf schema does: the API method and path, and where every flag goes. A dry run shows the exact request.',
	'auth whoami': 'This app signs in with the API token you pasted, which is checked with Cloudflare when you save it.'
}
// Commands with a page of their own that does more than the console can, such as a price
// check before a purchase. The server only allows dry runs of these from here.
const GUIDED = {
	'registrar registrations create': {
		title: 'Register domains on the Registrar page',
		description:
			'It shows Cloudflare’s quote, asks you to confirm the total and checks the price again just before buying, as cf does. A dry run still works here.',
		label: 'Open Registrar',
		to: '/registrar'
	}
}
// Options lists longer than this get a filter box, and start collapsed.
const FILTER_FROM = 8

const notify = useNotify()
const { run } = useCfCommands()
const { zones, loading: zonesLoading, error: zonesError, load: loadZones, findZone } = useZones()
const { accounts, loading: accountsLoading, error: accountsError, load: loadAccounts } = useAccounts()

// --- Form state ---------------------------------------------------------------------------

const values = ref({})
const bodyText = ref('')
const fileInputs = ref({})
const files = ref({})
const target = ref('account')
const zoneId = ref('')
const accountId = ref('')
// Once someone picks an account it stays; until then it follows the chosen zone.
const accountChosen = ref(false)
const optionsOpen = ref(false)
const optionFilter = ref('')
const fieldErrors = ref({})
const inputError = ref('')

const response = ref(null)
const responseDry = ref(false)
const running = ref(false)
const lastRunDry = ref(false)
const confirmOpen = ref(false)

const reset = () => {
	values.value = {}
	fileInputs.value = {}
	files.value = {}
	fieldErrors.value = {}
	bodyText.value = ''
	optionFilter.value = ''
	inputError.value = ''
	response.value = null
	optionsOpen.value = optionalFlags.value.length <= FILTER_FROM
	// cf acts on the account unless --zone is given; a zone page's console starts on the zone.
	target.value = props.command.scope === 'accountOrZone' && props.initialZoneId ? 'zone' : 'account'
}

watch(() => props.command.command, reset)

// --- Scope --------------------------------------------------------------------------------

const onZone = computed(() => actsOnZone(props.command, target.value))
const usesAccount = computed(() => needsAccount(props.command, target.value))
const scopeControls = computed(() => onZone.value || usesAccount.value || props.command.scope === 'accountOrZone')
const scopeLabel = computed(() => SCOPE_LABELS[props.command.scope] || props.command.scope)

const zoneItems = computed(() => {
	const list = zones.value.map((zone) => ({
		label: zone.name,
		value: zone.id,
		description: zone.status === 'active' ? undefined : zone.status
	}))
	if (zoneId.value && !list.some((item) => item.value === zoneId.value)) {
		list.unshift({ label: 'Current zone', value: zoneId.value })
	}
	return list
})
const accountItems = computed(() =>
	accounts.value.map((account) => ({ label: account.name || account.id, value: account.id }))
)

const zoneName = computed(() => findZone(zoneId.value)?.name || '')

watch(
	() => props.initialZoneId,
	(id) => {
		if (id && !zoneId.value) zoneId.value = id
	},
	{ immediate: true }
)

// The account defaults to the chosen zone's, or the token's only account.
const defaultAccount = () => {
	const fromZone = findZone(zoneId.value)?.account?.id
	if (fromZone && accounts.value.some((account) => account.id === fromZone)) return fromZone
	return accounts.value.length === 1 ? accounts.value[0].id : fromZone || ''
}
watch([zoneId, accounts], () => {
	if (!accountChosen.value || !accountId.value) accountId.value = defaultAccount()
})

const chooseAccount = (id) => {
	accountId.value = id || ''
	accountChosen.value = Boolean(id)
}

watch(
	[onZone, usesAccount],
	([zone, account]) => {
		if (zone) loadZones()
		if (account) {
			loadZones()
			loadAccounts().then(() => {
				if (!accountId.value) accountId.value = defaultAccount()
			})
		}
	},
	{ immediate: true }
)

// --- Fields -------------------------------------------------------------------------------

const requiredFlags = computed(() => props.command.flags.filter((flag) => flag.required))
const optionalFlags = computed(() => props.command.flags.filter((flag) => !flag.required))
const requiredBodyFlags = computed(() => requiredFlags.value.filter((flag) => flag.in === 'body'))
const filteredOptionalFlags = computed(() => {
	const text = optionFilter.value.trim().toLowerCase()
	if (!text) return optionalFlags.value
	return optionalFlags.value.filter(
		(flag) => flag.name.includes(text) || (flag.description || '').toLowerCase().includes(text)
	)
})

const isSet = (value) =>
	Array.isArray(value) ? value.some(isSet) : value !== undefined && value !== null && value !== ''
const setOptionalCount = computed(() => optionalFlags.value.filter((flag) => isSet(values.value[flag.name])).length)

const fileFields = computed(() => (props.command.form || []).filter((field) => field.file))
const takesBody = computed(() => ['json', 'octet-stream'].includes(props.command.bodyKind))
const bodyReplacesFlags = computed(
	() => props.command.bodyKind === 'json' && props.command.flags.some((flag) => flag.in === 'body')
)
const bodyRequired = computed(
	() => props.command.bodyKind === 'octet-stream' || (props.command.bodyKind === 'json' && !bodyReplacesFlags.value)
)
const bodyHelp = computed(() => {
	if (props.command.bodyKind === 'octet-stream') {
		return `Sent as it is${props.command.contentType ? `, as ${props.command.contentType}` : ''}.`
	}
	if (bodyReplacesFlags.value) {
		return 'Optional. The whole request body as JSON, for fields the options above don’t cover. It replaces the body options, as cf’s --body does.'
	}
	return 'This command takes its request body as JSON. See Cloudflare’s API docs for its fields.'
})

// Reads the file as base64 so binary files arrive intact.
const setFile = async (field, file) => {
	fileInputs.value = { ...fileInputs.value, [field]: file || null }
	fieldErrors.value[`file:${field}`] = ''
	const { [field]: _previous, ...others } = files.value
	files.value = others
	if (!file) return
	try {
		const bytes = new Uint8Array(await file.arrayBuffer())
		let binary = ''
		for (let index = 0; index < bytes.length; index += 0x8000) {
			binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
		}
		files.value = { ...files.value, [field]: { name: file.name, base64: btoa(binary) } }
	} catch {
		fieldErrors.value[`file:${field}`] = 'Couldn’t read that file. Choose it again.'
	}
}

// --- Command line and payload ------------------------------------------------------------

const cleanValues = (inputs) =>
	Object.fromEntries(
		inputs
			.filter((input) => isSet(values.value[input.name]))
			.map((input) => {
				const value = values.value[input.name]
				return [input.name, Array.isArray(value) ? value.filter(isSet) : value]
			})
	)

const bodyValue = computed(() => (bodyText.value.trim() ? bodyText.value : undefined))

const commandLine = computed(() =>
	cfCommandLine(props.command, {
		values: cleanValues([...props.command.args, ...props.command.flags]),
		zone: zoneName.value || zoneId.value,
		account: accountId.value,
		target: target.value,
		body: bodyValue.value,
		files: files.value
	})
)

const payload = (dryRun) => ({
	command: props.command.command,
	zone: onZone.value ? zoneId.value : undefined,
	account: usesAccount.value ? accountId.value : undefined,
	target: props.command.scope === 'accountOrZone' ? target.value : undefined,
	args: cleanValues(props.command.args),
	flags: cleanValues(props.command.flags),
	body: bodyValue.value,
	files: Object.keys(files.value).length ? { ...files.value } : undefined,
	dryRun
})

// --- Running ------------------------------------------------------------------------------

const destructive = computed(() => Boolean(props.command.confirm) || props.command.method === 'DELETE')
const confirmDescription = computed(() =>
	props.command.confirm
		? 'cf asks before running this command, because it changes, deletes or charges for something and can’t be undone from here.'
		: 'This deletes something in your Cloudflare account. It can’t be undone from here.'
)

const formRoot = useTemplateRef('formRoot')
const outputRoot = useTemplateRef('outputRoot')

const clearErrors = () => {
	fieldErrors.value = {}
	inputError.value = ''
}

// The checks the server would make first, so the field can say what's wrong.
const validate = () => {
	clearErrors()
	if (onZone.value && !zoneId.value) fieldErrors.value.zone = 'Choose the zone to run this against'
	if (usesAccount.value && !accountId.value) fieldErrors.value.account = 'Choose the account to run this against'
	for (const arg of props.command.args) {
		if (arg.required && !isSet(values.value[arg.name])) fieldErrors.value[arg.name] = `<${arg.name}> is required`
	}
	for (const flag of requiredFlags.value) {
		const coveredByBody = flag.in === 'body' && bodyValue.value !== undefined
		if (!coveredByBody && !isSet(values.value[flag.name]))
			fieldErrors.value[flag.name] = `--${flag.name} is required`
	}
	if (bodyRequired.value && bodyValue.value === undefined && !fileFields.value.length) {
		fieldErrors.value.body = 'Enter the request body'
	}
	if (props.command.bodyKind === 'json' && bodyValue.value !== undefined) {
		try {
			JSON.parse(bodyValue.value)
		} catch (error) {
			fieldErrors.value.body = `This isn’t valid JSON: ${error.message}`
		}
	}
	return !Object.values(fieldErrors.value).some(Boolean)
}

const focusFirstError = async () => {
	await nextTick()
	if (!optionsOpen.value && optionalFlags.value.some((flag) => fieldErrors.value[flag.name])) {
		optionsOpen.value = true
		await nextTick()
	}
	const invalid = formRoot.value?.querySelector('[aria-invalid="true"]')
	const control = invalid?.matches('input, textarea, button')
		? invalid
		: invalid?.querySelector('input, textarea, button')
	control?.focus()
}

// The server names the flag in its message (“--type must be one of …”), so put it there.
const placeServerError = (message) => {
	const match = /^(--[\w.-]+|<[\w.-]+>)/.exec(message)
	const name = match?.[1].replace(/^--|^<|>$/g, '')
	const known = [...props.command.args, ...props.command.flags].some((input) => input.name === name)
	if (known) fieldErrors.value[name] = message
	else inputError.value = message
	if (known) focusFirstError()
}

const execute = async (dryRun) => {
	if (running.value) return
	running.value = true
	lastRunDry.value = dryRun
	try {
		const result = await run(payload(dryRun))
		response.value = result
		responseDry.value = dryRun
		confirmOpen.value = false
		await nextTick()
		outputRoot.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
	} catch (error) {
		confirmOpen.value = false
		if (isInputError(error)) placeServerError(describeError(error))
		else inputError.value = describeError(error, 'The command didn’t run. Try again.')
	} finally {
		running.value = false
	}
}

const requestRun = (dryRun) => {
	if (props.command.local || running.value) return
	if (!validate()) {
		focusFirstError()
		return
	}
	if (!dryRun && destructive.value) {
		confirmOpen.value = true
		return
	}
	execute(dryRun)
}

const confirmRun = () => execute(false)

const nextPage = ({ flag, value }) => {
	values.value[flag] = value
	execute(false)
}

defineShortcuts({
	meta_enter: {
		usingInput: true,
		handler: () => requestRun(false)
	}
})

const guided = computed(() => GUIDED[props.command.command] || null)

const methodColor = computed(() => METHOD_COLORS[props.command.method] || 'neutral')
const localExplanation = computed(
	() =>
		LOCAL_NOTES[props.command.command] ||
		'It works with files, processes or tools on the computer it runs on, so it can’t run from this server.'
)

reset()
</script>
