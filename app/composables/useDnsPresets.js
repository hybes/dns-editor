import { PRESET_PREFIX, presetKey } from '~/utils/storage'

// DNS record presets persisted in localStorage. Previously this CRUD was copy-pasted
// into both the create and edit pages.
export function useDnsPresets() {
	const presets = ref([])

	const refresh = () => {
		if (import.meta.server) return
		const seen = new Set()
		const names = []
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)
			if (key && key.startsWith(PRESET_PREFIX)) {
				const name = key.slice(PRESET_PREFIX.length)
				if (!seen.has(name)) {
					seen.add(name)
					names.push(name)
				}
			}
		}
		presets.value = names.sort((a, b) => a.localeCompare(b))
	}

	const save = (name, payload) => {
		const trimmed = (name || '').trim()
		if (!trimmed) return false
		localStorage.setItem(presetKey(trimmed), JSON.stringify(payload))
		refresh()
		return true
	}

	const load = (name) => {
		try {
			const raw = localStorage.getItem(presetKey(name))
			return raw ? JSON.parse(raw) : null
		} catch {
			return null
		}
	}

	const remove = (name) => {
		localStorage.removeItem(presetKey(name))
		refresh()
	}

	return { presets, refresh, save, load, remove }
}
