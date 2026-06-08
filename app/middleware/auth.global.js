import { STORAGE_KEYS } from '~/utils/storage'

// Single authoritative auth redirect. Runs client-side only (localStorage is not
// available during SSR), so individual pages no longer need their own onMounted guard.
export default defineNuxtRouteMiddleware((to) => {
	if (import.meta.server) return
	if (to.path === '/login') return

	const key = (localStorage.getItem(STORAGE_KEYS.apiKey) || '').trim()
	if (!key) return navigateTo('/login')
})
