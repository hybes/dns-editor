// The signed-in DNS Manager account and its Cloudflare connections (never their tokens),
// shared by every page. The session itself is an HttpOnly cookie the page can't read, so
// load() asks the server; the route middleware calls it before the first page renders.
export function useAuth() {
	const state = useState('dm-auth', () => ({ loaded: false, user: null, connections: [], sharedWithMe: 0 }))

	const set = (result) => {
		state.value = {
			loaded: true,
			user: result?.user || null,
			connections: result?.connections || [],
			sharedWithMe: result?.sharedWithMe || 0
		}
		return state.value
	}

	const load = async ({ force = false } = {}) => {
		if (state.value.loaded && !force) return state.value
		const response = await $fetch('/api/auth/me', { method: 'POST', body: {}, timeout: 30_000 }).catch(() => null)
		return set(response?.result)
	}

	const post = (endpoint, body) => $fetch(`/api/auth/${endpoint}`, { method: 'POST', body, timeout: 30_000 })

	const signIn = async (username, password) => {
		await post('login', { username, password })
		return load({ force: true })
	}

	const signUp = async (username, password, confirm) => {
		await post('signup', { username, password, confirm })
		return load({ force: true })
	}

	const signOut = async () => {
		await post('logout', {}).catch(() => null)
		set(null)
	}

	return {
		user: computed(() => state.value.user),
		connections: computed(() => state.value.connections),
		// How many shares others have made with this account
		sharedWithMe: computed(() => state.value.sharedWithMe),
		loaded: computed(() => state.value.loaded),
		load,
		signIn,
		signUp,
		signOut,
		// Forget the signed-in account without asking the server, after it said the session ended.
		reset: () => set(null)
	}
}
