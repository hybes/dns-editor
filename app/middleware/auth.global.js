// Single authoritative sign-in redirect. Pages render client-side only, so the session is
// checked (useAuth().load(), once per page load) before the first page renders.
const PUBLIC = new Set(['/login', '/signup'])
// An invite link works signed in or out: it offers to sign in or create an account first.
const INVITE = /^\/invite\//
// Pages that work without a Cloudflare connection: adding one, the account itself, and tools
// that only look things up in public DNS.
const WITHOUT_CONNECTION = /^\/(connections|account|sharing|tools)(\/|$)/

export default defineNuxtRouteMiddleware(async (to) => {
	if (import.meta.server) return

	// Tokens now live on the server; don't leave one from before accounts in this browser.
	localStorage.removeItem(LEGACY_TOKEN_KEY)

	const auth = useAuth()
	await auth.load()
	const path = to.path.replace(/\/+$/, '') || '/'

	if (INVITE.test(path)) return

	if (PUBLIC.has(path)) {
		if (auth.user.value) return navigateTo(safeRedirect(to.query.redirect), { replace: true })
		return
	}

	if (!auth.user.value) {
		// Keep a deeper address, such as a shared record link, to return to after sign-in.
		const query = path === '/' || path === '/zones' ? undefined : { redirect: to.fullPath }
		return navigateTo({ path: '/login', query }, { replace: true })
	}

	// Someone with shared domains can work without a connection of their own.
	if (!auth.connections.value.length && !auth.sharedWithMe.value && !WITHOUT_CONNECTION.test(path)) {
		return navigateTo('/connections', { replace: true })
	}

	if (path === '/') return navigateTo('/zones', { replace: true })
})
