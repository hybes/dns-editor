import MiniSearch from 'minisearch'

// The cf command catalogue: every Cloudflare API operation the cf CLI offers, with where each
// flag goes in the request. scripts/sync-cf.mjs builds it from the cloudflare/cf source; run
// `npm run cf:sync` to move to a newer cf release.
//
// It's a few megabytes, so it loads on first use rather than with the server.

let loading = null

const load = () => {
	loading ||= import('../cf/catalogue.json').then(({ default: catalogue }) => {
		const byName = new Map(catalogue.commands.map((command) => [command.command, command]))
		const localByName = new Map(catalogue.local.map((command) => [command.command, command]))
		return { ...catalogue, byName, localByName, index: null }
	})
	return loading
}

// Accepts the command as typed in a terminal, with or without the leading `cf`.
export const normaliseCommandName = (value) =>
	String(value || '')
		.trim()
		.replace(/\s+/g, ' ')
		.replace(/^(cf|cloudflare) /, '')

export async function getCatalogue() {
	return load()
}

// The command, or null when cf has no API command by that name.
export async function findCfCommand(name) {
	const catalogue = await load()
	return catalogue.byName.get(normaliseCommandName(name)) || null
}

// A cf command that only runs on a local machine (dev, deploy, tunnels run…), or null.
export async function findLocalCommand(name) {
	const catalogue = await load()
	return catalogue.localByName.get(normaliseCommandName(name)) || null
}

// Same documents, fields and boosts as `cf cli search`, so the console ranks commands the way
// the CLI does. Local-only commands are included, as they are in cf, and flagged in results.
const searchIndex = (catalogue) => {
	if (catalogue.index) return catalogue.index
	const groupText = (words) =>
		words
			.slice(0, -1)
			.map((_, index) => catalogue.groups[words.slice(0, index + 1).join(' ')] || '')
			.join(' ')

	const documents = [
		...catalogue.commands.map((command) => ({
			command: command.command,
			summary: command.summary,
			description: command.description,
			context: [
				groupText(command.command.split(' ')),
				...command.args.map((arg) => `${arg.name} ${arg.description || ''}`),
				...command.flags.map((flag) => `${flag.name} ${flag.description || ''}`)
			].join(' ')
		})),
		...catalogue.local
			.filter((command) => !catalogue.byName.has(command.command))
			.map((command) => ({
				command: command.command,
				summary: command.summary,
				description: command.summary,
				context: groupText(command.command.split(' '))
			}))
	]

	const index = new MiniSearch({
		fields: ['command', 'summary', 'description', 'context'],
		storeFields: ['command', 'summary'],
		idField: 'command'
	})
	index.addAll(documents)
	catalogue.index = index
	return index
}

// cf shows the top 5; the console asks for more so a list has something to scroll.
export async function searchCfCommands(query, { limit = 5 } = {}) {
	const catalogue = await load()
	const text = String(query || '').trim()
	if (!text) return []
	return searchIndex(catalogue)
		.search(text, {
			prefix: true,
			fuzzy: 0.2,
			boost: { command: 8, summary: 5, description: 2, context: 0.5 }
		})
		.slice(0, limit)
		.map(({ command, summary }) => {
			const entry = catalogue.byName.get(command)
			return entry ? commandSummary(entry) : { command, summary, local: true }
		})
}

// What a list of commands needs: enough to choose one, not its fields.
export const commandSummary = (command) => ({
	command: command.command,
	summary: command.summary,
	method: command.method,
	category: command.category,
	scope: command.scope,
	...(command.hidden && { hidden: true })
})

// One level of the command tree under `prefix` ('' for the top): the groups and commands
// directly beneath it, as `cf <prefix> --help` lists them.
export async function browseCfCommands(prefix = '') {
	const catalogue = await load()
	const base = normaliseCommandName(prefix)
	const depth = base ? base.split(' ').length : 0
	const groups = new Map()
	const commands = []

	const visit = (name, entry) => {
		if (base && !name.startsWith(`${base} `)) return
		const words = name.split(' ')
		if (words.length === depth + 1) {
			commands.push(entry)
			return
		}
		const group = words.slice(0, depth + 1).join(' ')
		groups.set(group, (groups.get(group) || 0) + 1)
	}
	for (const command of catalogue.commands) visit(command.command, commandSummary(command))
	for (const command of catalogue.local) {
		if (!catalogue.byName.has(command.command)) {
			visit(command.command, { command: command.command, summary: command.summary, local: true })
		}
	}

	// cf fills in a group's own name when the API docs give it no description; that says nothing.
	const describe = (name) => {
		const text = catalogue.groups[name] || ''
		return text === name.split(' ').pop() ? '' : text
	}

	return {
		prefix: base,
		description: base ? describe(base) : '',
		groups: [...groups]
			.map(([name, count]) => ({ name, description: describe(name), count }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		commands: commands.sort((a, b) => a.command.localeCompare(b.command))
	}
}
