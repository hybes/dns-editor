import { computed, unref } from 'vue'

export function useDynamicSeo({ title, description }) {
	const { site } = useAppConfig()

	const siteName = computed(() => site?.name || 'DNS Manager')
	const siteDescription = computed(() => site?.description || '')

	const resolvedTitle = computed(() => {
		const t = (unref(title) || '').trim()
		const n = (unref(siteName) || '').trim()
		if (!t) return n
		return t
	})

	const resolvedDescription = computed(() => {
		const d = (unref(description) || '').trim()
		if (d) return d
		return (unref(siteDescription) || '').trim()
	})

	useSeoMeta({
		title: resolvedTitle,
		description: resolvedDescription
	})
}
