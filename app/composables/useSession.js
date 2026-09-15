import { STORAGE_KEYS, SESSION_KEYS } from '~/utils/storage'

// Single source of truth for reading the API token and logging out.
export function useSession() {
	const router = useRouter()
	const toast = useToast()

	const getApiKey = () => {
		if (import.meta.server) return ''
		return (localStorage.getItem(STORAGE_KEYS.apiKey) || '').trim()
	}

	// The token is removed before navigating so the auth middleware lets /login through. If
	// a page blocks the navigation (say, unsaved changes the person chooses to keep), the
	// session is put back and nothing else is cleared. Returns whether the log out happened.
	const logout = async () => {
		const saved = SESSION_KEYS.map((key) => [key, localStorage.getItem(key)])
		for (const [key] of saved) localStorage.removeItem(key)

		const failure = await router.push('/login')
		if (failure) {
			for (const [key, value] of saved) {
				if (value !== null) localStorage.setItem(key, value)
			}
			return false
		}

		toast.remove('cf-token-rejected')
		// Every useState holding Cloudflare data uses a `cf-` key. Resetting (rather than
		// deleting) keeps any component still holding a ref from reading undefined.
		clearNuxtState((key) => key.startsWith('cf-'), { reset: true })
		return true
	}

	return { getApiKey, logout }
}
