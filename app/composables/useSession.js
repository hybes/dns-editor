import { STORAGE_KEYS, SESSION_KEYS } from '~/utils/storage'

// Single source of truth for reading the API token and logging out, replacing the
// copy-pasted resetConfig/logout blocks that previously lived in several pages.
export function useSession() {
	const router = useRouter()

	const getApiKey = () => {
		if (import.meta.server) return ''
		return (localStorage.getItem(STORAGE_KEYS.apiKey) || '').trim()
	}

	const logout = () => {
		if (import.meta.client) {
			for (const key of SESSION_KEYS) localStorage.removeItem(key)
		}

		const caps = useState('cf-capabilities')
		if (caps.value) {
			caps.value = { apiKey: null, global: null, zones: {}, loading: false }
		}

		return router.push('/login')
	}

	return { getApiKey, logout }
}
