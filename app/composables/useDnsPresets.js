import { PRESET_PREFIX, presetKey } from '~/utils/storage'

// A preset is applied to other names, so the hostname never goes in. Older presets stored
// it as `name` or inside SRV `data`, so it is stripped on the way out too.
const withoutHost = (values) => {
	if (!values || typeof values !== 'object') return null
	const { name: _name, host: _host, ...clean } = values
	if (clean.data && typeof clean.data === 'object') {
		const { name: _dataName, ...data } = clean.data
		clean.data = data
	}
	return clean
}

// Named record presets kept in this browser's localStorage.
export function useDnsPresets() {
	const presets = ref([])

	const refresh = () => {
		if (import.meta.server) return
		try {
			const names = new Set()
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i)
				if (key?.startsWith(PRESET_PREFIX)) names.add(key.slice(PRESET_PREFIX.length))
			}
			presets.value = [...names].sort((a, b) => a.localeCompare(b))
		} catch {
			presets.value = []
		}
	}

	const has = (name) => presets.value.includes((name || '').trim())

	const save = (name, values) => {
		const trimmed = (name || '').trim()
		if (!trimmed) return false
		try {
			localStorage.setItem(presetKey(trimmed), JSON.stringify(withoutHost(values)))
		} catch {
			return false
		}
		refresh()
		return true
	}

	const load = (name) => {
		try {
			const raw = localStorage.getItem(presetKey(name))
			return raw ? withoutHost(JSON.parse(raw)) : null
		} catch {
			return null
		}
	}

	const remove = (name) => {
		try {
			localStorage.removeItem(presetKey(name))
		} catch {
			// Storage is unavailable; the list below still reflects what is stored.
		}
		refresh()
	}

	return { presets, refresh, has, save, load, remove }
}
