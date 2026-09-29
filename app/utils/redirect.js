// An in-app path to return to after signing in, from ?redirect=. Anything else, or a path back
// to the sign-in pages, goes to the zones list.
export const safeRedirect = (target) => {
	if (typeof target !== 'string' || !target.startsWith('/') || /^\/[\\/]/.test(target)) return '/zones'
	return /^\/(login|signup)\b/.test(target) ? '/zones' : target
}
