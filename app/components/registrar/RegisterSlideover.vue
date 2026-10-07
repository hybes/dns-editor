<template>
	<USlideover
		:open="open"
		:title="submitted ? `Registering ${confirmed?.domain}` : 'Register a domain'"
		:description="accountLabel ? `In the ${accountLabel} account` : ''"
		:dismissible="!submitting"
		:close="{ disabled: submitting }"
		:ui="{ footer: 'flex-col items-stretch gap-3' }"
		@update:open="setOpen"
	>
		<template #body>
			<div class="flex flex-col gap-6">
				<template v-if="submitted && confirmed">
					<UAlert
						:color="submittedMeta.color"
						variant="subtle"
						:icon="submittedMeta.icon"
						:title="submittedMeta.title"
						:description="submittedMeta.description"
					/>

					<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
						<dt class="text-muted">Domain</dt>
						<dd class="text-default font-mono break-all">{{ confirmed.domain }}</dd>
						<dt class="text-muted">Term</dt>
						<dd class="text-default">{{ yearsText(confirmed.years) }}</dd>
						<dt class="text-muted">Quoted price</dt>
						<dd class="text-default tabular-nums">{{ confirmed.totalText }}</dd>
						<dt class="text-muted">Auto-renew</dt>
						<dd class="text-default">{{ confirmed.autoRenew ? 'On' : 'Off' }}</dd>
					</dl>

					<RegistrarWorkflowStatus
						:account="account"
						:domain="confirmed.domain"
						command="registrar registrations get-registration-status"
						label="Registration"
						:status="submitted"
						poll
						@update="onStatus"
					/>
				</template>

				<template v-else>
					<form class="flex flex-col gap-3" novalidate @submit.prevent="runCheck">
						<UFormField
							label="Domain"
							name="register-domain"
							required
							:error="domainError || false"
							help="The full name including its ending, such as example.com."
						>
							<div class="flex gap-2">
								<UInput
									ref="domainField"
									v-model="domainInput"
									placeholder="example.com"
									autocomplete="off"
									autocapitalize="off"
									:spellcheck="false"
									:disabled="submitting"
									class="min-w-0 flex-1"
									:ui="{ base: 'font-mono' }"
									@update:model-value="domainError = ''"
								/>
								<UButton
									type="submit"
									label="Check"
									icon="i-lucide-search"
									color="neutral"
									variant="outline"
									:loading="checking"
									:disabled="submitting || quoting"
								/>
							</div>
						</UFormField>
					</form>

					<p v-if="checking" class="text-muted flex items-center gap-2 text-sm" role="status">
						<UIcon
							name="i-lucide-loader-circle"
							class="size-4 shrink-0 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>
						Checking with Cloudflare Registrar…
					</p>

					<UAlert
						v-else-if="checkError"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						role="alert"
						title="Couldn’t check the domain"
						:description="checkError"
						:actions="[
							{
								label: 'Try again',
								icon: 'i-lucide-refresh-cw',
								color: 'neutral',
								variant: 'outline',
								onClick: runCheck
							}
						]"
					/>

					<section
						v-if="check && !checking"
						aria-labelledby="register-availability-heading"
						class="flex flex-col gap-1.5"
					>
						<h3
							id="register-availability-heading"
							class="text-highlighted font-mono text-sm font-medium break-all"
						>
							{{ checkedDomain }}
						</h3>
						<RegistrarCheckVerdict
							:result="check.missing ? null : check"
							:account="account"
							class="text-default text-sm"
						/>
						<p v-if="canRegister" class="text-default text-sm tabular-nums">
							{{ money(pricing.registration_cost) }} for the first year, then
							{{ money(pricing.renewal_cost) }} a year to renew.
						</p>
						<p v-if="priceNotice" role="status" class="text-warning text-sm">{{ priceNotice }}</p>
						<p v-if="domainEdited && !checking" class="text-warning text-sm">
							The domain field has changed. Press Check to check the new name before registering.
						</p>
					</section>

					<RegistrarWorkflowStatus
						v-if="uncertain && checkedDomain"
						:account="account"
						:domain="checkedDomain"
						command="registrar registrations get-registration-status"
						label="Registration status"
					/>

					<template v-if="canRegister">
						<div v-if="schemaLoading" class="flex flex-col gap-3" aria-busy="true">
							<span class="sr-only" role="status">Loading what the registry needs…</span>
							<USkeleton class="h-5 w-40" />
							<USkeleton v-for="row in 4" :key="row" class="h-10 w-full" />
						</div>

						<UAlert
							v-else-if="schemaError"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							role="alert"
							title="Couldn’t load the registration details"
							:description="`${schemaError} Without them this app can’t tell what the registry needs, so it won’t register the domain.`"
							:actions="[
								{
									label: 'Try again',
									icon: 'i-lucide-refresh-cw',
									color: 'neutral',
									variant: 'outline',
									onClick: loadSchema
								}
							]"
						/>

						<form
							v-else-if="schema"
							:id="formId"
							ref="formRoot"
							class="flex flex-col gap-6"
							novalidate
							@submit.prevent="review"
						>
							<section aria-labelledby="register-term-heading" class="flex flex-col gap-4">
								<h3 id="register-term-heading" class="text-highlighted text-sm font-medium">
									Registration
								</h3>
								<UFormField
									label="Registration term"
									name="register-years"
									required
									:description="termHelp"
									:error="yearsError || false"
								>
									<USelect v-model="years" :items="termItems" class="w-full" />
								</UFormField>
								<USwitch
									v-model="autoRenew"
									label="Renew automatically"
									description="Off unless you turn it on. Turning it on authorises Cloudflare to charge the account’s default payment method every year, up to 30 days before the domain expires, at the registry’s renewal price at the time."
								/>
								<UFormField
									v-if="privacyItems.length"
									label="WHOIS privacy"
									name="register-privacy"
									description="Some endings don’t support redaction."
								>
									<USelect v-model="privacyMode" :items="privacyItems" class="w-full" />
								</UFormField>
								<p v-if="!hasContactFields" class="text-muted text-sm">
									Cloudflare uses the account’s default contact from the Cloudflare dashboard as the
									registrant.
								</p>
							</section>

							<section
								v-for="group in mainGroups"
								:key="group.id"
								:aria-labelledby="`register-group-${group.id}`"
								class="flex flex-col gap-4"
							>
								<div class="flex flex-col gap-1">
									<h3 :id="`register-group-${group.id}`" class="text-highlighted text-sm font-medium">
										{{ group.title }}
									</h3>
									<p v-if="group.description" class="text-muted text-sm">{{ group.description }}</p>
								</div>
								<URadioGroup
									v-if="group.id === 'registrant' && contactOptional"
									v-model="contactMode"
									:items="CONTACT_MODES"
									legend="Registrant contact"
									:ui="{ legend: 'sr-only' }"
								/>
								<template v-if="group.id !== 'registrant' || contactModeInUse === 'custom'">
									<RegistrarSchemaField
										v-for="field in group.fields"
										:key="field.key"
										v-model="values[field.key]"
										:field="field"
										:required="isRequired(field)"
										:error="fieldErrors[field.key]"
									/>
								</template>
							</section>

							<UCollapsible
								v-if="optionalGroups.length && contactModeInUse === 'custom'"
								v-model:open="otherContactsOpen"
								class="flex flex-col gap-4"
							>
								<UButton
									label="Other contacts"
									color="neutral"
									variant="link"
									trailing-icon="i-lucide-chevron-down"
									class="group self-start px-0"
									:ui="{
										trailingIcon:
											'transition-transform duration-200 group-data-[state=open]:rotate-180'
									}"
								/>
								<template #content>
									<div class="flex flex-col gap-6 pt-1">
										<p class="text-muted text-sm">
											Optional. When the registry needs one of these, Cloudflare can fill it in
											from the registrant contact.
										</p>
										<fieldset
											v-for="group in optionalGroups"
											:key="group.id"
											class="flex flex-col gap-4"
										>
											<legend class="text-highlighted pb-3 text-sm font-medium">
												{{ group.title }}
											</legend>
											<RegistrarSchemaField
												v-for="field in group.fields"
												:key="field.key"
												v-model="values[field.key]"
												:field="field"
												:required="isRequired(field)"
												:error="fieldErrors[field.key]"
											/>
										</fieldset>
									</div>
								</template>
							</UCollapsible>

							<AccountJsonPanel
								:value="requestBody"
								label="Edit as JSON"
								editable
								apply-label="Apply to form"
								help="Applying replaces the form with this JSON. Fields the form doesn’t show are sent as they are, and domain_name is always the domain you checked."
								@apply="applyJson"
								@dirty="onJsonDirty"
							/>
						</form>
					</template>
				</template>
			</div>

			<RegistrarConfirmModal
				v-model:open="confirmOpen"
				:title="
					confirmed ? `Register ${confirmed.domain} for ${confirmed.totalText}?` : 'Register this domain?'
				"
				:description="confirmed?.sentence"
				:confirm-label="confirmed ? `Register for ${confirmed.totalText}` : 'Register'"
				confirm-icon="i-lucide-badge-check"
				:action="submit"
			>
				<dl v-if="confirmed" class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
					<dt class="text-muted">Domain</dt>
					<dd class="font-mono break-all">{{ confirmed.domain }}</dd>
					<template v-if="accountLabel">
						<dt class="text-muted">Account</dt>
						<dd class="break-words">{{ accountLabel }}</dd>
					</template>
					<dt class="text-muted">Term</dt>
					<dd>{{ yearsText(confirmed.years) }}</dd>
					<dt class="text-muted">Due now</dt>
					<dd class="text-highlighted font-semibold tabular-nums">{{ confirmed.totalText }}</dd>
					<dt class="text-muted">Renewal</dt>
					<dd class="tabular-nums">{{ confirmed.renewalText }} a year at today’s price</dd>
					<dt class="text-muted">Auto-renew</dt>
					<dd>{{ confirmed.autoRenew ? 'On, so renewals are charged automatically' : 'Off' }}</dd>
					<dt class="text-muted">Registrant</dt>
					<dd class="break-words">{{ confirmed.registrant }}</dd>
				</dl>
			</RegistrarConfirmModal>
		</template>

		<template #footer>
			<div v-if="submitted" class="flex w-full justify-end gap-2">
				<UButton label="Done" @click="setOpen(false)" />
			</div>

			<template v-else>
				<UAlert
					v-if="submitError"
					role="alert"
					:color="uncertain ? 'warning' : 'error'"
					variant="subtle"
					:icon="uncertain ? 'i-lucide-triangle-alert' : 'i-lucide-circle-alert'"
					:title="submitErrorTitle"
					:description="submitError"
				/>
				<p v-if="canRegister && schema && total" class="text-default text-sm">
					Registering <span class="font-mono break-all">{{ checkedDomain }}</span> for
					{{ yearsText(years) }} costs
					<span class="text-highlighted font-semibold tabular-nums">{{ money(total) }}</span
					>. Cloudflare charges the account’s default payment method, and it can’t be refunded.
				</p>
				<div class="flex w-full flex-wrap justify-end gap-2">
					<UButton
						label="Cancel"
						color="neutral"
						variant="outline"
						:disabled="submitting"
						@click="setOpen(false)"
					/>
					<UButton
						type="submit"
						:form="formId"
						label="Review and register"
						icon="i-lucide-badge-check"
						:loading="quoting"
						:disabled="!canRegister || !schema || !total || checking || submitting || domainEdited"
					/>
				</div>
			</template>
		</template>
	</USlideover>
</template>

<script setup>
// Registering a domain with Cloudflare Registrar, which is billable and can't be refunded. It
// follows cf's `registrar registrations create`: check availability and price, load the
// extension's registration schema and build the form from it, show the quote, check the price
// again, and only then ask for an explicit confirmation of the exact total. The server route
// checks once more immediately before submitting and refuses if anything changed.
const props = defineProps({
	open: { type: Boolean, default: false },
	account: { type: String, required: true },
	accountLabel: { type: String, default: '' },
	// Checked straight away when the panel opens, such as from ?register=
	domain: { type: String, default: '' }
})

const emit = defineEmits(['update:open', 'registered'])

const { exec } = useCfCommands()
const { call } = useCfApi()
const formId = useId()

const MAX_TERM = 10
const CURRENCY = /^[A-Z]{3}$/
const AMOUNT = /^\d+(?:\.\d+)?$/
// Set by the panel's own controls, so never collected as schema fields.
const CORE_KEYS = new Set(['domain_name', 'years', 'auto_renew', 'privacy_mode'])
// Keys that would reach an object's prototype if used as a path.
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const MAX_DEPTH = 6

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Cloudflare's documented contact phone format: +{country code}.{number}
const PHONE = /^\+\d{1,3}\.\d{4,14}$/
const COUNTRY = /^[A-Z]{2}$/

// Contact fields described in Cloudflare's registration docs. A pattern from the extension's
// own schema takes precedence over the ones here.
const CONTACT_FIELDS = {
	name: { label: 'Full name', autocomplete: 'name', help: 'The full legal name, including the family name.' },
	organization: {
		label: 'Organisation',
		autocomplete: 'organization',
		help: 'Leave empty when the domain is for an individual.'
	},
	email: {
		label: 'Email',
		type: 'email',
		autocomplete: 'email',
		pattern: EMAIL,
		problem: 'Enter an email address, such as name@example.com',
		help: 'The registry sends ownership checks and renewal notices here.'
	},
	phone: {
		label: 'Phone',
		type: 'tel',
		autocomplete: 'tel',
		pattern: PHONE,
		problem: 'Use a plus sign, the country code, a dot, then the number, such as +44.2071234567',
		help: 'A plus sign, the country code, a dot, then the number with no spaces, such as +44.2071234567.'
	},
	fax: {
		label: 'Fax',
		type: 'tel',
		autocomplete: 'off',
		pattern: PHONE,
		problem: 'Use a plus sign, the country code, a dot, then the number, such as +44.2071234567',
		help: 'In the same format as the phone number.'
	},
	street: { label: 'Street address', autocomplete: 'street-address' },
	city: { label: 'Town or city', autocomplete: 'address-level2' },
	state: {
		label: 'State, county or region',
		autocomplete: 'address-level1',
		help: 'Use the standard abbreviation where there is one, such as TX or ON.'
	},
	postal_code: { label: 'Postcode or ZIP code', autocomplete: 'postal-code' },
	country_code: {
		label: 'Country code',
		autocomplete: 'country',
		pattern: COUNTRY,
		problem: 'Use a two-letter country code, such as GB',
		help: 'Two letters, such as GB or US.',
		maxLength: 2,
		upper: true
	}
}
const CONTACT_ORDER = ['name', 'organization', 'email', 'phone', 'fax', 'street', 'city', 'state', 'postal_code']

const ROLE_TITLES = {
	administrator: 'Administrative contact',
	technical: 'Technical contact',
	billing: 'Billing contact'
}

const PRIVACY_LABELS = {
	redaction: 'Redact contact details where the registry allows it',
	off: 'Publish contact details in WHOIS'
}

const CONTACT_MODES = [
	{
		value: 'default',
		label: 'Use the account’s default contact',
		description:
			'The default address book entry in the Cloudflare dashboard. Without one, Cloudflare rejects the registration.'
	},
	{ value: 'custom', label: 'Enter a contact for this domain' }
]

const JSON_UNAPPLIED = 'You have JSON edits that haven’t been applied. Apply them to the form or discard them first.'

// --- Values and paths ------------------------------------------------------------------------

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const clone = (value) => JSON.parse(JSON.stringify(value ?? {}))
const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index)
const titleCase = (text) =>
	String(text)
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part, index) => (index === 0 ? part[0].toUpperCase() + part.slice(1) : part))
		.join(' ')
const yearsText = (count) => `${count} ${count === 1 ? 'year' : 'years'}`

const getPath = (target, path) => path.reduce((node, key) => (isObject(node) ? node[key] : undefined), target)

const setPath = (target, path, value) => {
	let node = target
	for (const key of path.slice(0, -1)) {
		if (!isObject(node[key])) node[key] = {}
		node = node[key]
	}
	node[path[path.length - 1]] = value
}

const deletePath = (target, path) => {
	const parent = getPath(target, path.slice(0, -1))
	if (isObject(parent)) Reflect.deleteProperty(parent, path[path.length - 1])
}

// Drops objects left empty once form fields are taken out, so {} isn't sent for them.
const pruneEmpty = (node) => {
	for (const [key, value] of Object.entries(node)) {
		if (isObject(value)) {
			pruneEmpty(value)
			if (!Object.keys(value).length) Reflect.deleteProperty(node, key)
		}
	}
	return node
}

// --- Registration schema -----------------------------------------------------------------------
// Extension schemas are JSON Schema: nested objects with `required`, choices as `enum` or
// `oneOf` of `const` values with titles, acknowledgements as `const: true`, and conditional
// requirements in `allOf` / `if` / `then` (such as .uk's company number for companies).

const patterns = new Map()
const compilePattern = (source) => {
	if (typeof source !== 'string') return null
	if (!patterns.has(source)) {
		try {
			patterns.set(source, new RegExp(source, 'u'))
		} catch {
			patterns.set(source, null)
		}
	}
	return patterns.get(source)
}

const TYPE_CHECKS = {
	string: (value) => typeof value === 'string',
	integer: (value) => Number.isInteger(value),
	number: (value) => typeof value === 'number' && Number.isFinite(value),
	boolean: (value) => typeof value === 'boolean',
	object: isObject,
	array: Array.isArray,
	null: (value) => value === null
}

// Whether a value meets a schema, for the keywords registration schemas use. Keywords it
// doesn't know pass, so Cloudflare remains the final check.
const satisfies = (schema, value) => {
	if (!isObject(schema)) return true
	const types = [].concat(schema.type ?? [])
	if (types.length && !types.some((type) => TYPE_CHECKS[type]?.(value) ?? true)) return false
	if (schema.const !== undefined && !sameJson(schema.const, value)) return false
	if (Array.isArray(schema.enum) && !schema.enum.some((choice) => sameJson(choice, value))) return false
	if (typeof value === 'string') {
		const length = [...value].length
		if (typeof schema.minLength === 'number' && length < schema.minLength) return false
		if (typeof schema.maxLength === 'number' && length > schema.maxLength) return false
		const pattern = compilePattern(schema.pattern)
		if (pattern && !pattern.test(value)) return false
	}
	if (typeof value === 'number') {
		if (typeof schema.minimum === 'number' && value < schema.minimum) return false
		if (typeof schema.maximum === 'number' && value > schema.maximum) return false
		if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return false
		if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) return false
	}
	if (isObject(value)) {
		if (Array.isArray(schema.required) && schema.required.some((key) => value[key] === undefined)) return false
		for (const [key, child] of Object.entries(isObject(schema.properties) ? schema.properties : {})) {
			if (value[key] !== undefined && !satisfies(child, value[key])) return false
		}
	}
	if (Array.isArray(schema.allOf) && !schema.allOf.every((clause) => satisfies(clause, value))) return false
	if (Array.isArray(schema.anyOf) && !schema.anyOf.some((clause) => satisfies(clause, value))) return false
	if (Array.isArray(schema.oneOf) && schema.oneOf.filter((clause) => satisfies(clause, value)).length !== 1) {
		return false
	}
	if (isObject(schema.not) && satisfies(schema.not, value)) return false
	if (isObject(schema.if)) {
		const branch = satisfies(schema.if, value) ? schema.then : schema.else
		if (isObject(branch) && !satisfies(branch, value)) return false
	}
	return true
}

// The properties and required keys an object schema declares for its current value: its own,
// those in allOf clauses, the branch of each if/then/else that applies, and the alternative of
// oneOf/anyOf the value matches. When no single alternative matches, every alternative's
// properties are offered as optional.
const objectShape = (schema, value, shape = { properties: new Map(), required: new Set() }) => {
	if (!isObject(schema)) return shape
	for (const [key, child] of Object.entries(isObject(schema.properties) ? schema.properties : {})) {
		if (UNSAFE_KEYS.has(key)) continue
		shape.properties.set(key, [...(shape.properties.get(key) || []), child])
	}
	for (const key of Array.isArray(schema.required) ? schema.required : []) shape.required.add(key)
	for (const clause of Array.isArray(schema.allOf) ? schema.allOf : []) objectShape(clause, value, shape)
	if (isObject(schema.if)) {
		const branch = satisfies(schema.if, value) ? schema.then : schema.else
		if (isObject(branch)) objectShape(branch, value, shape)
	}
	for (const alternatives of [schema.oneOf, schema.anyOf]) {
		if (!Array.isArray(alternatives) || !alternatives.length) continue
		const matching = alternatives.filter((clause) => satisfies(clause, value))
		if (matching.length === 1) objectShape(matching[0], value, shape)
		else {
			for (const clause of alternatives) {
				objectShape(clause, value, { properties: shape.properties, required: new Set() })
			}
		}
	}
	return shape
}

const declaresObject = (schemas) =>
	schemas.some(
		(schema) =>
			isObject(schema) &&
			(schema.type === 'object' ||
				isObject(schema.properties) ||
				(Array.isArray(schema.allOf) && declaresObject(schema.allOf)))
	)

// One description of a field declared in several places. Bounds take the strictest value;
// everything else takes the first declaration.
const flatten = (schemas, into = {}) => {
	for (const schema of schemas) {
		if (!isObject(schema)) continue
		for (const key of [
			'type',
			'title',
			'description',
			'const',
			'enum',
			'pattern',
			'default',
			'format',
			'oneOf',
			'anyOf'
		]) {
			if (into[key] === undefined && schema[key] !== undefined) into[key] = schema[key]
		}
		for (const key of ['minimum', 'minLength', 'exclusiveMinimum']) {
			if (typeof schema[key] === 'number') into[key] = Math.max(into[key] ?? -Infinity, schema[key])
		}
		for (const key of ['maximum', 'maxLength', 'exclusiveMaximum']) {
			if (typeof schema[key] === 'number') into[key] = Math.min(into[key] ?? Infinity, schema[key])
		}
		if (Array.isArray(schema.allOf)) flatten(schema.allOf, into)
	}
	return into
}

// Choices from `enum`, or from `oneOf`/`anyOf` alternatives that are each a `const` (with a
// title) or an `enum`. Only text and number choices, which a select can hold.
const choicesOf = (info) => {
	const usable = (value) => typeof value === 'string' || typeof value === 'number'
	if (Array.isArray(info.enum)) {
		return info.enum.every(usable) ? info.enum.map((value) => ({ value, label: String(value) })) : null
	}
	const variants = info.oneOf || info.anyOf
	if (!Array.isArray(variants) || !variants.length) return null
	const choices = []
	for (const variant of variants) {
		if (!isObject(variant)) return null
		const list = variant.const !== undefined ? [variant.const] : Array.isArray(variant.enum) ? variant.enum : null
		if (!list || !list.every(usable)) return null
		for (const value of list) {
			const label = list.length === 1 && variant.title ? `${variant.title} (${value})` : String(value)
			choices.push({ value, label })
		}
	}
	return choices
}

const makeField = (path, schemas, required, ancestors) => {
	const info = flatten(schemas)
	const name = path[path.length - 1]
	const contact = path[0] === 'contacts' ? CONTACT_FIELDS[name] : null
	const type = [].concat(info.type ?? []).find((item) => item !== 'null')
	const choices = choicesOf(info)
	let kind = 'text'
	if (type === 'boolean' && info.const === true) kind = 'acknowledgement'
	else if (choices) kind = 'choice'
	else if (type === 'boolean') kind = 'boolean'
	else if (type === 'integer' || type === 'number') kind = 'number'
	const description = typeof info.description === 'string' ? info.description.trim() : ''
	const title = typeof info.title === 'string' ? info.title.trim() : ''
	return {
		key: path.join('/'),
		path,
		schemas,
		info,
		required,
		ancestors,
		kind,
		choices,
		label: title || contact?.label || titleCase(name),
		help: contact?.help || description.split('\n')[0],
		// An acknowledgement's description is the wording the registry asks the registrant to accept.
		text: description || title || `I agree (${name})`,
		inputType: contact?.type || (info.format === 'email' ? 'email' : 'text'),
		autocomplete: contact?.autocomplete || 'off',
		pattern: compilePattern(info.pattern) || contact?.pattern || null,
		problem: contact?.problem || '',
		maxLength: typeof info.maxLength === 'number' ? info.maxLength : contact?.maxLength,
		min: typeof info.minimum === 'number' ? info.minimum : undefined,
		max: typeof info.maximum === 'number' ? info.maximum : undefined,
		integer: type === 'integer',
		upper: contact?.upper === true
	}
}

// Every field the schema asks for, given the values so far. Each carries whether its parent
// object requires it, and the chain of objects above it with whether each is required.
const collectFields = (schema, draft) => {
	const fields = []
	const walk = (node, path, ancestors) => {
		if (path.length > MAX_DEPTH) return
		const value = getPath(draft, path)
		const shape = objectShape(node, isObject(value) ? value : {})
		for (const [key, schemas] of shape.properties) {
			const childPath = [...path, key]
			const required = shape.required.has(key)
			if (declaresObject(schemas)) {
				walk({ allOf: schemas }, childPath, [...ancestors, { key: childPath.join('/'), required }])
			} else {
				fields.push(makeField(childPath, schemas, required, ancestors))
			}
		}
	}
	walk(schema, [], [])
	return fields
}

// --- Money -------------------------------------------------------------------------------------

const money = (amount, currency = pricing.value?.currency) => formatMoney(amount, currency)

const parseDecimal = (text) => {
	const match = /^(\d+)(?:\.(\d+))?$/.exec(String(text ?? ''))
	return match ? { units: BigInt(`${match[1]}${match[2] || ''}`), scale: (match[2] || '').length } : null
}

// The first year at the registration price and each later year at the renewal price, in exact
// decimals as cf works it out. Returns a decimal string, or '' if the prices can't be read.
const totalCost = (prices, term) => {
	const first = parseDecimal(prices?.registration_cost)
	const renewal = parseDecimal(prices?.renewal_cost)
	if (!first || !renewal || !Number.isInteger(term) || term < 1) return ''
	const scale = Math.max(first.scale, renewal.scale)
	const scaled = (decimal) => decimal.units * 10n ** BigInt(scale - decimal.scale)
	const sum = scaled(first) + scaled(renewal) * BigInt(term - 1)
	if (!scale) return sum.toString()
	const divisor = 10n ** BigInt(scale)
	return `${sum / divisor}.${(sum % divisor).toString().padStart(scale, '0')}`
}

const tidyAmount = (text) => {
	const [whole, fraction = ''] = String(text ?? '').split('.')
	const cleanFraction = fraction.replace(/0+$/, '')
	return cleanFraction ? `${whole}.${cleanFraction}` : whole
}

const samePricing = (a, b) =>
	a?.currency === b?.currency &&
	tidyAmount(a?.registration_cost) === tidyAmount(b?.registration_cost) &&
	tidyAmount(a?.renewal_cost) === tidyAmount(b?.renewal_cost)

// Registrable, standard-priced and with prices cf could quote: the only names cf will register.
const canRegisterResult = (result) =>
	result?.registrable === true &&
	result.tier === 'standard' &&
	CURRENCY.test(result.pricing?.currency || '') &&
	AMOUNT.test(String(result.pricing?.registration_cost ?? '')) &&
	AMOUNT.test(String(result.pricing?.renewal_cost ?? ''))

// --- Domain ------------------------------------------------------------------------------------

const toAsciiDomain = (value) => {
	const text = String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/\.$/, '')
	if (!text) return ''
	try {
		return new URL(`http://${text}`).hostname
	} catch {
		return ''
	}
}

const domainProblem = (raw, ascii) => {
	const text = String(raw ?? '').trim()
	if (!text) return 'Enter the domain to register, such as example.com.'
	if (/[\s/:@?#\\]/.test(text) || !ascii || !isHostname(ascii, { allowUnderscore: false })) {
		return `“${text}” isn’t a domain name. Enter one such as example.com.`
	}
	if (!ascii.includes('.')) return 'Include the ending, such as .com.'
	return ''
}

// example.co.uk could register under co.uk or uk. Cloudflare knows which, so each is tried in
// turn, longest first, as cf does.
const extensionCandidates = (domain) => {
	const labels = domain.split('.')
	return labels.slice(1).map((_, index) => labels.slice(index + 1).join('.'))
}

// --- State -------------------------------------------------------------------------------------

const domainField = useTemplateRef('domainField')
const formRoot = useTemplateRef('formRoot')

const domainInput = ref('')
const domainError = ref('')
const checking = ref(false)
const checkError = ref('')
const check = ref(null)
const checkedDomain = ref('')
const priceNotice = ref('')

const schema = ref(null)
const extension = ref('')
const schemaLoading = ref(false)
const schemaError = ref('')
// The extension schemas don't change while the page is open.
const schemaCache = new Map()

const values = reactive({})
const extra = ref({})
const years = ref(1)
const yearsError = ref('')
const autoRenew = ref(false)
const privacyMode = ref('')
const contactMode = ref('default')
const fieldErrors = reactive({})
const otherContactsOpen = ref(false)
const jsonDirty = ref(false)

const quoting = ref(false)
const confirmOpen = ref(false)
const confirmed = ref(null)
const submitting = ref(false)
const submitError = ref('')
const uncertain = ref(false)
const submitted = ref(null)

let checkToken = 0
let schemaToken = 0

const pricing = computed(() => (canRegisterResult(check.value) ? check.value.pricing : null))
const canRegister = computed(() => Boolean(pricing.value))
// The field no longer names the domain that was checked, so the quote below isn't for it.
const domainEdited = computed(
	() => Boolean(checkedDomain.value) && toAsciiDomain(domainInput.value) !== checkedDomain.value
)
const total = computed(() => (pricing.value ? totalCost(pricing.value, years.value) : ''))

// Plain values from the form, for evaluating the schema's conditions.
const draft = computed(() => {
	const body = {}
	for (const [key, value] of Object.entries(values)) {
		let clean
		if (typeof value === 'string') clean = value.trim() || undefined
		else if (typeof value === 'number') clean = Number.isFinite(value) ? value : undefined
		else if (typeof value === 'boolean') clean = value
		if (clean !== undefined) setPath(body, key.split('/'), clean)
	}
	return body
})

const fields = computed(() => (schema.value ? collectFields(schema.value, draft.value) : []))
const rootRequired = computed(() => (schema.value ? objectShape(schema.value, draft.value).required : new Set()))
const coreField = (name) => fields.value.find((field) => field.key === name) || null
const formFields = computed(() => fields.value.filter((field) => !CORE_KEYS.has(field.path[0])))

const hasContactFields = computed(() => formFields.value.some((field) => field.path[0] === 'contacts'))
// Without contacts, Cloudflare uses the account's default address book entry.
const contactOptional = computed(() => hasContactFields.value && !rootRequired.value.has('contacts'))
const contactModeInUse = computed(() => (contactOptional.value ? contactMode.value : 'custom'))

const activeFields = computed(() =>
	formFields.value.filter((field) => field.path[0] !== 'contacts' || contactModeInUse.value === 'custom')
)

const wireValue = (field, value) => {
	if (field.kind === 'acknowledgement') return value === true ? true : undefined
	if (field.kind === 'boolean') return typeof value === 'boolean' && (value || field.required) ? value : undefined
	if (field.kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : undefined
	if (field.kind === 'choice') return field.choices.some((choice) => choice.value === value) ? value : undefined
	if (typeof value !== 'string' || !value.trim()) return undefined
	return field.upper ? value.trim().toUpperCase() : value.trim()
}

const presentKeys = computed(() => {
	const keys = new Set()
	for (const field of activeFields.value) {
		if (wireValue(field, values[field.key]) !== undefined) keys.add(field.key)
	}
	return keys
})

const hasValueUnder = (key) => [...presentKeys.value].some((present) => present.startsWith(`${key}/`))

// Required when its object requires it and that object is being sent: because it's required
// all the way up, because someone chose to enter a contact, or because some of it is filled in.
const isRequired = (field) =>
	field.required &&
	field.ancestors.every(
		(ancestor) =>
			ancestor.required ||
			(ancestor.key === 'contacts' && contactModeInUse.value === 'custom') ||
			hasValueUnder(ancestor.key)
	)

const groupOf = (field) => {
	const [top, role] = field.path
	if (top === 'contacts') return field.path.length < 3 || role === 'registrant' ? 'registrant' : `contact:${role}`
	if (top === 'contact_extensions') return 'registry'
	if (top === 'acknowledgements' || field.kind === 'acknowledgement') return 'agreements'
	return 'other'
}

const contactRank = (field) => {
	const index = CONTACT_ORDER.indexOf(field.path[field.path.length - 1])
	return index === -1 ? CONTACT_ORDER.length : index
}

const groups = computed(() => {
	const ext = extension.value ? `.${extension.value}` : 'this'
	const meta = {
		registrant: {
			title: 'Registrant contact',
			description:
				'The domain’s legal owner. These details go to the registry and, depending on the ending and privacy settings, may appear in public WHOIS.'
		},
		registry: { title: 'Registry details', description: `Information the ${ext} registry asks for.` },
		agreements: { title: 'Agreements', description: `The ${ext} registry asks the registrant to accept these.` },
		other: { title: 'Other details', description: '' }
	}
	const byId = new Map()
	for (const field of formFields.value) {
		const id = groupOf(field)
		if (!byId.has(id)) {
			const role = id.startsWith('contact:') ? id.slice(8) : ''
			byId.set(id, {
				id: id.replace(':', '-'),
				title: meta[id]?.title || ROLE_TITLES[role] || `${titleCase(role)} contact`,
				description: meta[id]?.description || '',
				// Other contact roles sit in a collapsed section unless the schema requires them.
				optional: Boolean(role),
				fields: []
			})
		}
		const group = byId.get(id)
		group.fields.push(field)
		// A role the schema requires inside contacts is sent whenever a contact is entered.
		if (group.optional && field.ancestors[1]?.required) group.optional = false
	}
	for (const group of byId.values()) {
		if (group.id === 'registrant' || group.id.startsWith('contact-')) {
			group.fields = [...group.fields].sort((a, b) => contactRank(a) - contactRank(b))
		}
	}
	const order = ['registrant', 'registry', 'agreements', 'other']
	return [...byId.values()].sort((a, b) => {
		const rank = (group) => (order.includes(group.id) ? order.indexOf(group.id) : order.length)
		return rank(a) - rank(b)
	})
})

const mainGroups = computed(() => groups.value.filter((group) => !group.optional))
const optionalGroups = computed(() => groups.value.filter((group) => group.optional))

// --- Term and privacy ----------------------------------------------------------------------------

const termOptions = computed(() => {
	const info = coreField('years')?.info
	const whole = (list) =>
		[...new Set(list.filter((value) => Number.isInteger(value) && value >= 1 && value <= MAX_TERM))].sort(
			(a, b) => a - b
		)
	if (!info) return range(1, MAX_TERM)
	if (info.const !== undefined) return whole([info.const])
	if (Array.isArray(info.enum)) return whole(info.enum)
	const choices = choicesOf(info)
	if (choices) return whole(choices.map((choice) => choice.value))
	let min = typeof info.minimum === 'number' ? Math.ceil(info.minimum) : 1
	let max = typeof info.maximum === 'number' ? Math.floor(info.maximum) : MAX_TERM
	if (typeof info.exclusiveMinimum === 'number') min = Math.max(min, Math.floor(info.exclusiveMinimum) + 1)
	if (typeof info.exclusiveMaximum === 'number') max = Math.min(max, Math.ceil(info.exclusiveMaximum) - 1)
	return range(Math.max(1, min), Math.min(MAX_TERM, max))
})

const defaultTerm = () => {
	const preferred = coreField('years')?.info?.default
	return termOptions.value.includes(preferred) ? preferred : termOptions.value[0]
}

const termItems = computed(() => termOptions.value.map((value) => ({ label: yearsText(value), value })))

const termHelp = computed(() => {
	if (!pricing.value) return ''
	if (termOptions.value.length === 1) {
		return `The .${extension.value} registry registers for ${yearsText(termOptions.value[0])} at a time.`
	}
	return `The first year costs ${money(pricing.value.registration_cost)} and each extra year ${money(pricing.value.renewal_cost)}.`
})

const privacyItems = computed(() => {
	const choices = coreField('privacy_mode')?.choices || []
	return choices.map((choice) => ({ value: choice.value, label: PRIVACY_LABELS[choice.value] || choice.label }))
})

const defaultPrivacy = () => {
	const field = coreField('privacy_mode')
	const options = privacyItems.value.map((item) => item.value)
	if (options.includes(field?.info?.default)) return field.info.default
	return options.includes('redaction') ? 'redaction' : options[0] || ''
}

watch(termOptions, (options) => {
	if (schema.value && !options.includes(years.value)) years.value = defaultTerm()
})

// --- Request body --------------------------------------------------------------------------------

const requestBody = computed(() => {
	const body = clone(extra.value)
	for (const field of activeFields.value) {
		deletePath(body, field.path)
		const value = wireValue(field, values[field.key])
		if (value !== undefined) setPath(body, field.path, value)
	}
	if (contactModeInUse.value === 'default') delete body.contacts
	for (const key of CORE_KEYS) Reflect.deleteProperty(body, key)
	pruneEmpty(body)
	const core = { domain_name: checkedDomain.value, years: years.value, auto_renew: autoRenew.value }
	if (privacyItems.value.length && privacyMode.value) core.privacy_mode = privacyMode.value
	return { ...core, ...body }
})

const emptyValue = (field) => {
	const preferred = field.info.default
	if (field.kind === 'acknowledgement') return false
	if (field.kind === 'boolean') return typeof preferred === 'boolean' ? preferred : false
	if (field.kind === 'number') return typeof preferred === 'number' ? preferred : undefined
	if (field.kind === 'choice')
		return field.choices.some((choice) => choice.value === preferred) ? preferred : undefined
	return typeof preferred === 'string' ? preferred : ''
}

// New fields start empty or at the schema's default; values already typed are kept, so
// checking another domain doesn't lose a contact.
const initValues = () => {
	for (const field of collectFields(schema.value, {})) {
		if (!CORE_KEYS.has(field.path[0]) && !(field.key in values)) values[field.key] = emptyValue(field)
	}
	years.value = defaultTerm()
	privacyMode.value = defaultPrivacy()
	extra.value = {}
}

const toFormValue = (field, value) => {
	if (field.kind === 'acknowledgement' || field.kind === 'boolean') return value === true
	if (field.kind === 'number') return typeof value === 'number' ? value : undefined
	if (field.kind === 'choice') return field.choices.some((choice) => choice.value === value) ? value : undefined
	if (value === undefined || value === null) return ''
	return typeof value === 'string' ? value : String(value)
}

const clearErrors = () => {
	for (const key of Object.keys(fieldErrors)) Reflect.deleteProperty(fieldErrors, key)
	yearsError.value = ''
}

const applyJson = (parsed) => {
	const next = clone(parsed)
	clearErrors()
	if (next.years !== undefined) {
		if (termOptions.value.includes(next.years)) years.value = next.years
		else yearsError.value = `The JSON asks for ${next.years} years, which isn’t a term this registry allows`
	}
	if (typeof next.auto_renew === 'boolean') autoRenew.value = next.auto_renew
	if (privacyItems.value.some((item) => item.value === next.privacy_mode)) privacyMode.value = next.privacy_mode
	if (contactOptional.value) contactMode.value = isObject(next.contacts) ? 'custom' : 'default'
	for (const key of CORE_KEYS) Reflect.deleteProperty(next, key)

	// Fields are collected against the JSON itself, so conditional fields it fills in count.
	const known = collectFields(schema.value, next).filter((field) => !CORE_KEYS.has(field.path[0]))
	const knownKeys = new Set(known.map((field) => field.key))
	for (const field of known) {
		values[field.key] = toFormValue(field, getPath(next, field.path))
		deletePath(next, field.path)
	}
	for (const field of formFields.value) {
		if (!knownKeys.has(field.key)) values[field.key] = emptyValue(field)
	}
	extra.value = pruneEmpty(next)
}

const onJsonDirty = (dirty) => {
	jsonDirty.value = dirty
	if (!dirty && submitError.value === JSON_UNAPPLIED) submitError.value = ''
}

// --- Validation ----------------------------------------------------------------------------------

const fieldProblem = (field) => {
	const value = wireValue(field, values[field.key])
	if (value === undefined) {
		if (!isRequired(field)) return ''
		if (field.kind === 'acknowledgement') return 'Tick this to agree. The registry requires it.'
		if (field.kind === 'choice') return 'Choose one of the options'
		return `${field.label} is required`
	}
	const info = field.info
	if (field.kind === 'number') {
		if (field.integer && !Number.isInteger(value)) return 'Enter a whole number'
		if (typeof info.minimum === 'number' && value < info.minimum) return `Enter ${info.minimum} or more`
		if (typeof info.maximum === 'number' && value > info.maximum) return `Enter ${info.maximum} or less`
	}
	if (typeof value === 'string') {
		const length = [...value].length
		if (typeof info.minLength === 'number' && length < info.minLength) {
			return `Use at least ${info.minLength} characters`
		}
		if (typeof info.maxLength === 'number' && length > info.maxLength) {
			return `Use ${info.maxLength} characters or fewer`
		}
		if (field.pattern && !field.pattern.test(value)) {
			return field.problem || 'This isn’t in the format the registry needs'
		}
	}
	if (!satisfies({ allOf: field.schemas }, value)) return field.problem || 'The registry doesn’t accept this value'
	return ''
}

const validate = () => {
	clearErrors()
	if (!termOptions.value.includes(years.value)) yearsError.value = 'Choose a term the registry allows'
	for (const field of activeFields.value) {
		const problem = fieldProblem(field)
		if (problem) fieldErrors[field.key] = problem
	}
	const failed = Object.keys(fieldErrors)
	if (optionalGroups.value.some((group) => group.fields.some((field) => failed.includes(field.key)))) {
		otherContactsOpen.value = true
	}
	return !failed.length && !yearsError.value
}

const focusFirstError = async () => {
	await nextTick()
	const invalid = formRoot.value?.querySelector('[aria-invalid="true"]')
	const target = invalid?.matches('input, textarea, button')
		? invalid
		: invalid?.querySelector('input, textarea, button')
	target?.focus()
}

const focusDomain = () => nextTick(() => domainField.value?.inputRef?.focus())

// --- Checking and loading ------------------------------------------------------------------------

const checkDomain = async (domain) => {
	const response = await exec(
		'registrar registrations check',
		{ account: props.account, body: { domains: [domain] } },
		{ fallback: 'Cloudflare Registrar didn’t answer' }
	)
	const matches = (response?.result?.domains || []).filter(
		(entry) => typeof entry?.name === 'string' && entry.name.toLowerCase() === domain
	)
	return matches.length === 1 ? matches[0] : { name: domain, registrable: false, missing: true }
}

const loadSchema = async () => {
	const domain = checkedDomain.value
	const id = ++schemaToken
	schemaLoading.value = true
	schemaError.value = ''
	const candidates = extensionCandidates(domain)
	let failure = ''
	let found = null
	for (const candidate of candidates) {
		const cacheKey = `${props.account}:${candidate}`
		if (schemaCache.has(cacheKey)) {
			found = { schema: schemaCache.get(cacheKey), extension: candidate }
			break
		}
		try {
			const response = await exec(
				'registrar extensions get',
				{ account: props.account, args: { extension: candidate } },
				{ fallback: `Cloudflare didn’t return the details for .${candidate}` }
			)
			if (id !== schemaToken) return
			const registration = response?.result?.registration_schema
			if (isObject(registration) && (registration.properties || registration.allOf || registration.oneOf)) {
				schemaCache.set(cacheKey, registration)
				found = { schema: registration, extension: response.result?.metadata?.name || candidate }
			} else {
				failure = `Cloudflare returned no registration details for .${candidate}.`
			}
			break
		} catch (error) {
			if (id !== schemaToken) return
			failure = describeError(error, `Cloudflare didn’t return the details for .${candidate}`)
			// Not found means “not this ending”, so the next, shorter one is tried.
			if (!/not found/i.test(failure)) break
		}
	}
	if (id !== schemaToken) return
	schemaLoading.value = false
	if (found) {
		schema.value = found.schema
		extension.value = found.extension
		initValues()
	} else {
		schema.value = null
		schemaError.value = /[.!?]$/.test(failure) ? failure : `${failure || 'Cloudflare has no details for it'}.`
	}
}

const runCheck = async () => {
	if (submitting.value || quoting.value) return
	const domain = toAsciiDomain(domainInput.value)
	domainError.value = domainProblem(domainInput.value, domain)
	if (domainError.value) {
		focusDomain()
		return
	}
	const id = ++checkToken
	checking.value = true
	checkError.value = ''
	priceNotice.value = ''
	submitError.value = ''
	uncertain.value = false
	check.value = null
	const sameExtension =
		checkedDomain.value && extensionCandidates(checkedDomain.value)[0] === extensionCandidates(domain)[0]
	if (!sameExtension) {
		schemaToken++
		schema.value = null
		schemaError.value = ''
		schemaLoading.value = false
	}
	try {
		const result = await checkDomain(domain)
		if (id !== checkToken) return
		check.value = result
		checkedDomain.value = domain
		if (canRegisterResult(result) && !schema.value) loadSchema()
	} catch (error) {
		if (id !== checkToken) return
		checkError.value = describeError(error, 'Cloudflare Registrar didn’t answer')
	} finally {
		if (id === checkToken) checking.value = false
	}
}

// --- Review, confirm and submit ------------------------------------------------------------------

const registrantSummary = (body) => {
	const registrant = body.contacts?.registrant
	if (!isObject(registrant)) return 'The account’s default contact'
	return [registrant.postal_info?.name, registrant.email].filter(Boolean).join(', ') || 'As entered'
}

// Validates, checks the price once more as cf does before quoting, then asks for confirmation
// of the exact total. A changed price is shown instead, for the person to review.
const review = async () => {
	if (submitting.value || quoting.value || !canRegister.value || domainEdited.value) return
	submitError.value = ''
	priceNotice.value = ''
	if (jsonDirty.value) {
		submitError.value = JSON_UNAPPLIED
		return
	}
	if (!validate()) {
		focusFirstError()
		return
	}
	const domain = checkedDomain.value
	const before = pricing.value
	quoting.value = true
	try {
		const fresh = await checkDomain(domain)
		// Closed, or another name checked, while the price was being checked again.
		if (!props.open || domain !== checkedDomain.value) return
		check.value = fresh
		if (!canRegisterResult(fresh)) {
			submitError.value = `Cloudflare can no longer register ${domain}. The reason is shown above.`
			return
		}
		if (!samePricing(before, fresh.pricing)) {
			priceNotice.value = `The price changed since you checked. Registering it for ${yearsText(years.value)} now costs ${money(totalCost(fresh.pricing, years.value), fresh.pricing.currency)}.`
			return
		}
		const body = clone(requestBody.value)
		const totalText = money(totalCost(fresh.pricing, years.value), fresh.pricing.currency)
		confirmed.value = {
			domain,
			body,
			years: years.value,
			autoRenew: autoRenew.value,
			pricing: { ...fresh.pricing },
			totalText,
			renewalText: money(fresh.pricing.renewal_cost, fresh.pricing.currency),
			registrant: registrantSummary(body),
			sentence: `Registering ${domain} for ${yearsText(years.value)} costs ${totalText}. Cloudflare charges the account’s default payment method, and it can’t be refunded.`
		}
		confirmOpen.value = true
	} catch (error) {
		submitError.value = describeError(error, 'Couldn’t check the price again. Nothing was registered.')
	} finally {
		quoting.value = false
	}
}

const submitErrorTitle = computed(() => {
	if (submitError.value === JSON_UNAPPLIED) return 'Your JSON edits haven’t been applied'
	if (uncertain.value) return 'It isn’t clear whether the registration went through'
	return 'The domain wasn’t registered'
})

// Resolves whatever happens, so the confirmation closes and the outcome shows in the panel. It
// sends one request and never retries.
const submit = async () => {
	const quote = confirmed.value
	if (!quote || submitting.value) return
	submitting.value = true
	submitError.value = ''
	uncertain.value = false
	try {
		const response = await call(
			'registrar_register',
			{
				account: props.account,
				domain: quote.domain,
				body: quote.body,
				quote: {
					currency: quote.pricing.currency,
					registration_cost: quote.pricing.registration_cost,
					renewal_cost: quote.pricing.renewal_cost,
					years: quote.years
				}
			},
			{ fallback: 'Cloudflare didn’t register the domain' }
		)
		submitted.value = response?.result || { state: 'pending', completed: false }
		emit('registered', { domain: quote.domain, status: submitted.value, pricing: quote.pricing })
	} catch (error) {
		const status = error?.statusCode ?? error?.data?.statusCode
		submitError.value = isPermissionError(error)
			? 'This connection cannot register domains in the selected account. It needs Registrar Edit. Check the token’s permissions and which connection is used first on the Cloudflare connections page.'
			: describeError(error, 'Cloudflare didn’t register the domain')
		if (status === 409) {
			// The re-check found a change. Show Cloudflare's current answer so it can be reviewed.
			const fresh = error?.data?.data?.check
			if (fresh) check.value = fresh
		} else if (error instanceof CfApiError) {
			uncertain.value = error.response?.uncertain === true
		} else if (status !== 400) {
			// Lost between the browser and this server, or between this server and Cloudflare.
			uncertain.value = true
		}
	} finally {
		submitting.value = false
	}
}

const submittedMeta = computed(() => {
	const status = submitted.value
	const domain = confirmed.value?.domain || ''
	if (status?.state === 'succeeded') {
		return {
			color: 'success',
			icon: 'i-lucide-circle-check',
			title: `${domain} is registered`,
			description: 'It now appears in the account’s registered domains.'
		}
	}
	if (status?.state === 'failed') {
		return {
			color: 'error',
			icon: 'i-lucide-circle-x',
			title: 'The registration failed',
			description:
				status.error?.message || 'Cloudflare didn’t say why. Check the status below before trying again.'
		}
	}
	if (status?.state === 'action_required') {
		return {
			color: 'warning',
			icon: 'i-lucide-hand',
			title: 'Cloudflare needs you to act',
			description: 'The details are below. Don’t submit the registration again.'
		}
	}
	return {
		color: 'info',
		icon: 'i-lucide-send',
		title: 'Registration submitted',
		description:
			'Cloudflare accepted the request and is registering it. This panel checks the status a few more times.'
	}
})

const onStatus = (status) => {
	if (!status) return
	const finished = status.state !== submitted.value?.state && ['succeeded', 'failed'].includes(status.state)
	submitted.value = status
	if (finished) emit('registered', { domain: confirmed.value.domain, status, pricing: confirmed.value.pricing })
}

// --- Opening and closing -------------------------------------------------------------------------

const reset = () => {
	checkToken++
	schemaToken++
	domainInput.value = ''
	domainError.value = ''
	checking.value = false
	checkError.value = ''
	check.value = null
	checkedDomain.value = ''
	priceNotice.value = ''
	schema.value = null
	extension.value = ''
	schemaLoading.value = false
	schemaError.value = ''
	for (const key of Object.keys(values)) Reflect.deleteProperty(values, key)
	extra.value = {}
	autoRenew.value = false
	contactMode.value = 'default'
	otherContactsOpen.value = false
	jsonDirty.value = false
	clearErrors()
	quoting.value = false
	confirmOpen.value = false
	confirmed.value = null
	submitError.value = ''
	uncertain.value = false
	submitted.value = null
}

const setOpen = (value) => {
	if (submitting.value) return
	emit('update:open', value)
}

watch(
	() => props.open,
	(open) => {
		if (!open) return
		reset()
		domainInput.value = props.domain
		if (props.domain) runCheck()
		else focusDomain()
	},
	{ immediate: true }
)
</script>
