import { SESSION_KEYS } from '~/utils/storage'

// The session key that per-account caches are stored under, and signing out.
export function useSession() {
	const router = useRouter()
	const toast = useToast()
	const auth = useAuth()

	// Changes when the account or its connections change, so cached Cloudflare data from before
	// is never shown after. Empty when nobody is signed in.
	const getSessionKey = () => {
		const user = auth.user.value
		if (import.meta.server || !user) return ''
		return `${user.id}:${auth.connections.value.map((connection) => connection.id).join(',')}`
	}

	const logout = async () => {
		await auth.signOut()
		for (const key of SESSION_KEYS) localStorage.removeItem(key)
		toast.remove('cf-token-rejected')
		// Every useState holding Cloudflare data uses a `cf-` key. Resetting (rather than
		// deleting) keeps any component still holding a ref from reading undefined.
		clearNuxtState((key) => key.startsWith('cf-'), { reset: true })
		await router.push('/login')
		return true
	}

	return { getSessionKey, logout }
}
