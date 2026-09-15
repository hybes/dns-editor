import { STORAGE_KEYS } from '~/utils/storage'

// Single authoritative auth redirect. Pages render client-side only, so the token is
// readable before the first page renders and pages need no guard of their own.
export default defineNuxtRouteMiddleware((to) => {
	if (import.meta.server) return

	const hasToken = Boolean((localStorage.getItem(STORAGE_KEYS.apiKey) || '').trim())
	const path = to.path.replace(/\/+$/, '') || '/'

	if (path === '/login') {
		// ?replace=1 lets someone swap an expired or revoked token without logging out first.
		if (hasToken && !to.query.replace) return navigateTo('/zones', { replace: true })
		return
	}

	if (!hasToken) {
		// Keep a deeper address, such as a shared record link, to return to after sign-in.
		const query = path === '/' || path === '/zones' ? undefined : { redirect: to.fullPath }
		return navigateTo({ path: '/login', query }, { replace: true })
	}

	if (path === '/') return navigateTo('/zones', { replace: true })
})
