// Writable dark-mode computed, shared so the toggle logic lives in one place.
export function useIsDark() {
	const colorMode = useColorMode()
	return computed({
		get() {
			return colorMode.value === 'dark'
		},
		set() {
			colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
		}
	})
}
