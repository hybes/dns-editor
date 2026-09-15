// Plain-HTTP deployments have no Clipboard API, so fall back to copying from a hidden
// textarea. Throws when neither route reaches the clipboard.
const writeClipboard = async (text) => {
	if (window.isSecureContext && navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text)
		return
	}
	const previousFocus = document.activeElement
	const area = document.createElement('textarea')
	area.value = text
	area.setAttribute('readonly', '')
	area.style.position = 'fixed'
	area.style.opacity = '0'
	document.body.appendChild(area)
	area.select()
	const copied = document.execCommand('copy')
	area.remove()
	previousFocus?.focus?.()
	if (!copied) throw new Error('Clipboard access was blocked')
}

// Consistent toasts for the outcomes every page reports: success, warnings, failure and copying.
export function useNotify() {
	const toast = useToast()

	const success = (title, description) =>
		toast.add({ title, description, icon: 'i-lucide-circle-check', color: 'success' })

	const warning = (title, description) =>
		toast.add({ title, description, icon: 'i-lucide-triangle-alert', color: 'warning', duration: 8000 })

	const error = (title, reason, fallback) =>
		toast.add({
			title,
			description: describeError(reason, fallback),
			icon: 'i-lucide-circle-alert',
			color: 'error',
			duration: 8000
		})

	const copy = async (text, label = 'Value') => {
		if (text === undefined || text === null || text === '') return
		try {
			await writeClipboard(String(text))
			toast.add({ title: `${label} copied`, icon: 'i-lucide-clipboard-check', color: 'neutral', duration: 2000 })
		} catch {
			error('Couldn’t copy', 'This browser blocked clipboard access. Select the text and copy it instead.')
		}
	}

	return { success, warning, error, copy }
}
