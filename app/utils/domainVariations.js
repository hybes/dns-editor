// Prefix and suffix variations of a name for Domain Search, such as getname or namehq.

export const NAME_VARIATIONS = [
	{ id: 'get', label: 'get…', apply: (name) => `get${name}` },
	{ id: 'try', label: 'try…', apply: (name) => `try${name}` },
	{ id: 'use', label: 'use…', apply: (name) => `use${name}` },
	{ id: 'my', label: 'my…', apply: (name) => `my${name}` },
	{ id: 'go', label: 'go…', apply: (name) => `go${name}` },
	{ id: 'the', label: 'the…', apply: (name) => `the${name}` },
	{ id: 'app', label: '…app', apply: (name) => `${name}app` },
	{ id: 'hq', label: '…hq', apply: (name) => `${name}hq` },
	{ id: 'labs', label: '…labs', apply: (name) => `${name}labs` },
	{ id: 'hub', label: '…hub', apply: (name) => `${name}hub` },
	{ id: 'now', label: '…now', apply: (name) => `${name}now` },
	{ id: 'plural', label: '…s', apply: (name) => (name.endsWith('s') ? '' : `${name}s`) }
]

// A name label is at most 63 letters, digits or hyphens, not starting or ending with a hyphen.
const VALID_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

// The variation names for these base names (labels without an ending), in the order given,
// leaving out any that are already among the names.
export const variationsOf = (names, selected) => {
	const chosen = NAME_VARIATIONS.filter((variation) => selected.includes(variation.id))
	const out = []
	for (const name of names) {
		for (const variation of chosen) {
			const candidate = variation.apply(name)
			if (candidate && VALID_LABEL.test(candidate) && !names.includes(candidate) && !out.includes(candidate)) {
				out.push(candidate)
			}
		}
	}
	return out
}
