<template>
	<div>
		<form class="flex flex-col gap-4" novalidate @submit.prevent="submit()">
			<UFormField label="Cloudflare API token" :error="fieldError || undefined" size="lg">
				<UInput
					ref="tokenInput"
					v-model="token"
					:type="showToken ? 'text' : 'password'"
					name="cloudflare-api-token"
					autocomplete="off"
					autocapitalize="off"
					:spellcheck="false"
					:autofocus="autofocus"
					size="lg"
					icon="i-lucide-key-round"
					placeholder="Paste your token"
					class="w-full"
					:ui="{ trailing: 'pe-1' }"
				>
					<template #trailing>
						<UButton
							:icon="showToken ? 'i-lucide-eye-off' : 'i-lucide-eye'"
							:aria-label="showToken ? 'Hide token' : 'Show token'"
							color="neutral"
							variant="link"
							size="sm"
							type="button"
							@click="showToken = !showToken"
						/>
					</template>
				</UInput>
			</UFormField>

			<div v-if="setup.ready" class="flex flex-col gap-3 text-sm text-pretty" aria-live="polite">
				<div class="flex flex-col gap-1">
					<p class="text-highlighted font-medium">This token can make DNS Manager’s token for you.</p>
					<p class="text-muted">
						DNS Manager will create a token called DNS Manager for all your accounts and zones, add it as a
						connection, and delete this one-off token. The new token doesn’t expire.
					</p>
				</div>
				<URadioGroup v-model="setup.coverage" :items="coverageItems" legend="What the new token can do" />
				<details class="group">
					<summary class="text-default flex cursor-pointer list-none items-center gap-1.5 font-medium">
						<UIcon
							name="i-lucide-chevron-right"
							class="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
							aria-hidden="true"
						/>
						Show the {{ formatNumber(chosenPermissions.length) }} permissions
					</summary>
					<dl class="text-muted mt-2 flex flex-col gap-1">
						<div v-for="group in setupGroups" :key="group.scope">
							<dt class="text-default inline font-medium">{{ group.label }}:</dt>
							<dd class="ms-1 inline">{{ group.names }}</dd>
						</div>
					</dl>
				</details>
				<p v-if="setup.coverage === 'app' && setup.app.missing.length" class="text-muted">
					Cloudflare doesn’t offer {{ missingNames }} today, so {{ missingUses }} won’t work with it.
				</p>
			</div>

			<div class="flex flex-col gap-2 sm:flex-row">
				<UButton type="submit" size="lg" block class="sm:flex-1" :loading="verifying" :label="submitLabel" />
				<UButton
					v-if="cancellable"
					size="lg"
					color="neutral"
					variant="ghost"
					label="Cancel"
					class="justify-center"
					@click="emit('cancel')"
				/>
			</div>
			<p role="status" class="sr-only">{{ verifying ? 'Checking the token with Cloudflare' : '' }}</p>

			<p class="text-muted text-sm text-pretty">
				The token is stored on this server, encrypted, and only used for your account. It never comes back to
				the browser.
			</p>
		</form>

		<section aria-labelledby="token-setup-title" class="border-default mt-10 border-t pt-6">
			<h2 id="token-setup-title" class="text-highlighted font-semibold">Don’t have a token?</h2>
			<p class="text-muted mt-2 text-sm text-pretty">
				DNS Manager can make its own token, with every permission its pages use, from a one-off set-up token
				that can create tokens.
			</p>
			<div class="mt-4 flex flex-col gap-3 text-sm">
				<UButton
					:to="TOKEN_SETUP_URL"
					target="_blank"
					icon="i-lucide-key-round"
					trailing-icon="i-lucide-external-link"
					color="neutral"
					variant="outline"
					class="self-start"
				>
					Create a set-up token in Cloudflare<span class="sr-only"> (opens in a new tab)</span>
				</UButton>
				<p class="text-muted text-pretty">
					Choose <strong class="text-default font-medium">Continue to summary</strong> and
					<strong class="text-default font-medium">Create Token</strong>, then paste the token above. DNS
					Manager uses it once to make its own token, then deletes it.
				</p>
				<p class="text-muted text-pretty">
					If the form opens without
					<strong class="text-default font-medium">User · API Tokens · Edit</strong>, add that permission, or
					use the <strong class="text-default font-medium">Create Additional Tokens</strong> template on
					Cloudflare’s API Tokens page instead.
				</p>
			</div>

			<details class="group mt-6">
				<summary class="text-default flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium">
					<UIcon
						name="i-lucide-chevron-right"
						class="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
						aria-hidden="true"
					/>
					Or choose the permissions yourself
				</summary>
				<ol class="text-muted marker:text-dimmed mt-3 flex list-decimal flex-col gap-5 ps-5 text-sm">
					<li>
						<div class="flex flex-col gap-3">
							<p class="text-pretty">
								Open Cloudflare’s token form with DNS Manager’s main permissions already chosen, for all
								your accounts and zones:
							</p>
							<UButton
								:to="TOKEN_TEMPLATE_URL"
								target="_blank"
								icon="i-lucide-key-round"
								trailing-icon="i-lucide-external-link"
								color="neutral"
								variant="outline"
								class="self-start"
							>
								Create a token in Cloudflare<span class="sr-only"> (opens in a new tab)</span>
							</UButton>
							<p class="text-pretty">
								It fills in <span class="text-default">{{ templateSummary }}</span
								>.
							</p>
						</div>
					</li>
					<li>
						<p class="text-pretty">
							Cloudflare’s link can’t fill in the rest, so add these in the same form for the pages you
							use:
						</p>
						<table class="mt-2 w-full">
							<caption class="sr-only">
								Permissions to add by hand and the pages that need them
							</caption>
							<thead>
								<tr class="text-dimmed border-default border-b text-start">
									<th scope="col" class="pe-3 pb-1.5 text-start font-medium">Permission</th>
									<th scope="col" class="pe-3 pb-1.5 text-start font-medium">Access</th>
									<th scope="col" class="pb-1.5 text-start font-medium">Used for</th>
								</tr>
							</thead>
							<tbody v-for="group in EXTRA_PERMISSIONS" :key="group.scope">
								<tr>
									<th
										scope="rowgroup"
										colspan="3"
										class="text-highlighted pt-3 pb-1 text-start font-medium"
									>
										{{ group.scope }}
									</th>
								</tr>
								<tr v-for="item in group.items" :key="item.name">
									<th scope="row" class="text-default py-1 pe-3 text-start align-top font-normal">
										{{ item.name }}
									</th>
									<td class="py-1 pe-3 align-top">{{ item.access }}</td>
									<td class="py-1 align-top">{{ item.use }}</td>
								</tr>
							</tbody>
						</table>
					</li>
					<li class="text-pretty">
						Choose <strong class="text-default font-medium">Continue to summary</strong>, then
						<strong class="text-default font-medium">Create Token</strong>, and paste the token above.
					</li>
				</ol>
				<p class="text-muted mt-4 text-sm text-pretty">
					To limit the token to some accounts or zones, change
					<strong class="text-default font-medium">Account Resources</strong> and
					<strong class="text-default font-medium">Zone Resources</strong> in the form before creating it.
				</p>
			</details>

			<p class="text-muted mt-6 text-sm text-pretty">
				Some features also depend on your Cloudflare plan, even with the right permissions. You can change a
				token’s permissions later in
				<ULink
					:to="API_TOKENS_URL"
					target="_blank"
					class="text-primary font-medium underline-offset-2 hover:underline"
				>
					API Tokens<span class="sr-only"> (opens in a new tab)</span>
				</ULink>
				without creating a new one.
			</p>
		</section>
	</div>
</template>

<script setup>
import {
	API_TOKENS_URL,
	APP_PERMISSIONS,
	TOKEN_SETUP_URL,
	TOKEN_TEMPLATE_PERMISSIONS,
	TOKEN_TEMPLATE_URL
} from '#shared/utils/cloudflare'

// Adding a Cloudflare connection: paste an API token and DNS Manager checks it with Cloudflare
// and stores it, encrypted, on the server. A one-off token that can only create tokens
// (Cloudflare's Create Additional Tokens template) is used to make DNS Manager's own token
// instead (server/api/token_setup.post.js), and that becomes the connection.
defineProps({
	// Show a Cancel button, when there's already a connection to go back to
	cancellable: { type: Boolean, default: false },
	autofocus: { type: Boolean, default: false }
})

const emit = defineEmits(['added', 'cancel'])

const SCOPE_LABELS = { zone: 'Zone', account: 'Account' }
const listFormat = new Intl.ListFormat('en-GB', { type: 'conjunction' })

// Permissions the template link can't fill in, one row per page that needs them. Names match
// Cloudflare's token form; one it doesn't document is found by searching the form's list.
const EXTRA_PERMISSIONS = Object.entries(SCOPE_LABELS).map(([scope, label]) => {
	const rows = new Map()
	for (const item of APP_PERMISSIONS.filter((entry) => entry.scope === scope && !entry.template)) {
		const key = `${item.access}|${item.use}`
		const name = item.name
		if (rows.has(key)) rows.get(key).names.push(name)
		else rows.set(key, { names: [name], access: item.access, use: item.use })
	}
	return {
		scope: label,
		items: [...rows.values()].map((row) => ({ name: row.names.join(', '), access: row.access, use: row.use }))
	}
})

const templateSummary = listFormat.format(TOKEN_TEMPLATE_PERMISSIONS.map((item) => `${item.name} ${item.access}`))

const { call } = useCfApi()
const toast = useToast()

const token = ref('')
const showToken = ref(false)
const verifying = ref(false)
const fieldError = ref('')
const tokenInput = useTemplateRef('tokenInput')

// A pasted token that can create tokens: what DNS Manager's own token would get, shown before
// it's made.
const emptySetup = () => ({
	ready: false,
	creating: false,
	coverage: 'app',
	app: { permissions: [], missing: [] },
	all: { permissions: [] }
})
const setup = reactive(emptySetup())
const resetSetup = () => Object.assign(setup, emptySetup())

const chosenPermissions = computed(() => setup[setup.coverage].permissions)

const coverageItems = computed(() => [
	{
		value: 'app',
		label: 'Everything DNS Manager’s pages use',
		description: `${formatNumber(setup.app.permissions.length)} permissions. The Console can still try other commands, but Cloudflare may refuse them.`
	},
	{
		value: 'all',
		label: 'Every Cloudflare permission',
		description: `${formatNumber(setup.all.permissions.length)} permissions, for all your Cloudflare resources and nearly any Console command. Cloudflare doesn’t let it manage tokens. It’s the most powerful kind of token.`
	}
])

const setupGroups = computed(() =>
	Object.entries(SCOPE_LABELS)
		.map(([scope, label]) => ({
			scope,
			label: `${label}s`,
			names: listFormat.format(
				chosenPermissions.value.filter((item) => item.scope === scope).map((item) => item.name)
			)
		}))
		.filter((group) => group.names)
)
const missingNames = computed(() => listFormat.format(setup.app.missing.map((item) => `${item.name} ${item.access}`)))
const missingUses = computed(() => listFormat.format([...new Set(setup.app.missing.map((item) => item.use))]))

const submitLabel = computed(() => {
	if (setup.creating) return 'Creating DNS Manager’s token…'
	if (verifying.value) return 'Checking with Cloudflare…'
	return setup.ready ? 'Create DNS Manager’s token and add it' : 'Check and add token'
})

watch(token, () => {
	fieldError.value = ''
	resetSetup()
})

// Focusing the field makes screen readers announce the error it now describes.
const showFieldError = async (message) => {
	fieldError.value = message
	await nextTick()
	tokenInput.value?.inputRef?.focus()
}

const added = (connection, message) => {
	toast.remove('cf-token-rejected')
	token.value = ''
	toast.add(message)
	emit('added', connection)
}

// What the one-off token would make, once Cloudflare has said it can create tokens.
const previewSetup = async (value) => {
	try {
		const response = await call(
			'token_setup',
			{ token: value, action: 'preview' },
			{ fallback: 'Cloudflare didn’t list the permissions DNS Manager can ask for.' }
		)
		Object.assign(setup, {
			ready: true,
			app: {
				permissions: response?.result?.app?.permissions || [],
				missing: response?.result?.app?.missing || []
			},
			all: { permissions: response?.result?.all?.permissions || [] }
		})
	} catch (error) {
		await showFieldError(describeError(error, 'Couldn’t check what this token can create. Try again.'))
	}
}

// Makes DNS Manager's token and adds it as a connection. The token itself stays on the server.
const createToken = async (value) => {
	setup.creating = true
	try {
		const response = await call(
			'token_setup',
			{ token: value, action: 'create', coverage: setup.coverage },
			{ fallback: 'Cloudflare didn’t create the token.' }
		)
		const made = response?.result
		added(made?.connection, {
			title: `Added ${made?.connection?.label || 'the connection'}`,
			description: made?.setupDeleted
				? 'DNS Manager made its own token and deleted the one-off token.'
				: 'DNS Manager made its own token but couldn’t delete the one-off token. Delete it in API Tokens in Cloudflare.',
			icon: 'i-lucide-key-round',
			color: made?.setupDeleted ? 'success' : 'warning',
			...(!made?.setupDeleted && {
				duration: 0,
				actions: [
					{
						label: 'Open API Tokens',
						color: 'neutral',
						variant: 'outline',
						to: API_TOKENS_URL,
						target: '_blank'
					}
				]
			})
		})
	} catch (error) {
		await showFieldError(describeError(error, 'Couldn’t create the token. Try again.'))
	} finally {
		setup.creating = false
	}
}

const submit = async () => {
	if (verifying.value) return
	const value = token.value.trim()
	if (!value) return showFieldError('Paste your Cloudflare API token.')
	verifying.value = true
	try {
		if (setup.ready) return await createToken(value)
		const response = await call(
			'connections/add',
			{ token: value },
			{ fallback: 'Cloudflare didn’t accept this token.' }
		)
		added(response?.result, {
			title: `Added ${response?.result?.label || 'the connection'}`,
			icon: 'i-lucide-key-round',
			color: 'success'
		})
	} catch (error) {
		if (error?.response?.reason === 'token_maker') return await previewSetup(value)
		await showFieldError(describeError(error, 'Couldn’t check the token. Try again.'))
	} finally {
		verifying.value = false
	}
}
</script>
