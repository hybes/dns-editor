// Auto-renew charges up to 30 days before expiry, so flag expiry inside that window.
const SOON_MS = 30 * 24 * 60 * 60 * 1000

export const expiresSoon = (registration) => {
	const time = Date.parse(registration?.expires_at || '')
	return Number.isFinite(time) && time - Date.now() < SOON_MS
}

// Whether a Registrar workflow (such as an auto-renew change) has finished.
export const isWorkflowFinished = (status) =>
	status?.completed === true || ['succeeded', 'failed'].includes(status?.state)

// Turning a Cloudflare Registrar domain's auto-renew on or off, with the confirmation the
// Registrar page and the Zones list both show in RegistrarConfirmModal. Cloudflare can accept a
// change and finish it later (202); those wait in `pending`, by domain, until the page sees them
// finish.
// - `priceNote(domain)`: a sentence about the renewal price for the confirmation, or ''.
// - `onChanged(registration)`: the registration with its new auto-renew, once Cloudflare has
//   made the change.
// - `pendingHint`: where the person can follow a change Cloudflare hasn't finished.
export function useAutoRenew({ priceNote = () => '', onChanged = () => {}, pendingHint = '' } = {}) {
	const { exec } = useCfCommands()
	const notify = useNotify()

	const pending = reactive(new Map())
	const open = ref(false)
	const target = ref(null)

	const ask = (registration, enable, account) => {
		if (!registration || !account || pending.has(registration.domain_name)) return
		target.value = { registration, enable, account }
		open.value = true
	}

	const copy = computed(() => {
		const current = target.value
		if (!current) return { title: 'Change auto-renew?', description: '', confirm: 'Change', detail: '' }
		const domain = current.registration.domain_name
		const date = formatDate(current.registration.expires_at)
		if (current.enable) {
			return {
				title: `Turn on auto-renew for ${domain}?`,
				description: `Cloudflare will charge the account’s default payment method to renew ${domain} every year, up to 30 days before it expires${date ? `, next on ${date}` : ''}.`,
				confirm: 'Turn on auto-renew',
				detail: priceNote(domain) || 'It renews at the registry’s price at the time, which can change.'
			}
		}
		return {
			title: `Turn off auto-renew for ${domain}?`,
			description: `${domain} won’t renew by itself. If nobody renews it before it expires${date ? ` on ${date}` : ''}, the registration lapses and someone else could register the name.`,
			confirm: 'Turn off auto-renew',
			detail: ''
		}
	})

	// Throws to keep the confirmation open with Cloudflare's message.
	const apply = async () => {
		const current = target.value
		if (!current) return
		const domain = current.registration.domain_name
		const response = await exec(
			'registrar registrations update',
			{ account: current.account, args: { 'domain-name': domain }, flags: { 'auto-renew': current.enable } },
			{ fallback: 'Cloudflare didn’t change auto-renew' }
		)
		const status = response?.result
		if (status?.state === 'failed') {
			throw new Error(status.error?.message || 'Cloudflare couldn’t change auto-renew.')
		}

		if (status && !isWorkflowFinished(status)) {
			pending.set(domain, status)
			notify.warning('Cloudflare is still changing auto-renew', pendingHint || domain)
		} else {
			onChanged({ ...current.registration, auto_renew: current.enable })
			notify.success(current.enable ? 'Auto-renew turned on' : 'Auto-renew turned off', domain)
		}
	}

	return { pending, open, target, ask, copy, apply }
}
