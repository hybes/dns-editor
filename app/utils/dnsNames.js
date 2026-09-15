// Converts between full record names and the zone-relative form people type ("www", "@").
// Comparisons ignore case and a trailing dot, as DNS does.

const clean = (value) =>
	String(value ?? '')
		.trim()
		.replace(/\.$/, '')

export const isInZone = (name, zone) => {
	const lowerName = clean(name).toLowerCase()
	const lowerZone = clean(zone).toLowerCase()
	if (!lowerName || !lowerZone) return false
	return lowerName === lowerZone || lowerName.endsWith(`.${lowerZone}`)
}

// "www.example.com" → "www", "example.com" → "@". Names outside the zone come back unchanged.
export const relativeName = (name, zone) => {
	const full = clean(name)
	const zoneName = clean(zone)
	if (!zoneName) return full
	const lower = full.toLowerCase()
	const lowerZone = zoneName.toLowerCase()
	if (lower === lowerZone) return '@'
	return lower.endsWith(`.${lowerZone}`) ? full.slice(0, -(zoneName.length + 1)) : full
}

// "www" → "www.example.com", "@" or blank → "example.com". Names already in the zone stay as typed.
export const qualifiedName = (name, zone) => {
	const value = clean(name)
	const zoneName = clean(zone)
	if (!zoneName) return value
	if (!value || value === '@') return zoneName
	return isInZone(value, zoneName) ? value : `${value}.${zoneName}`
}
