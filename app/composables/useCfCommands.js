// The cf command catalogue for the console: search as `cf cli search` does, browse the
// command tree as `cf <group> --help` lists it, read one command's arguments and flags, and
// run it. The catalogue is the same for every token, so details are kept for the session.
export function useCfCommands() {
	const details = useState('cf-console-commands', () => ({}))
	const levels = useState('cf-console-levels', () => ({}))
	const { call } = useCfApi()
	const { markChanged } = useDataChanges()

	// A change through /api/cf/run clears the server's cached reads for this token, so the
	// pages' own caches are treated as out of date too.
	const noteChange = (response) => {
		if (response?.success && !response.dryRun && response.request?.method !== 'GET') markChanged()
		return response
	}

	const search = async (query, { limit = 25 } = {}) => {
		const response = await call('cf/search', { query, limit }, { fallback: 'Search didn’t work' })
		return response?.result || []
	}

	const browse = async (prefix = '') => {
		if (levels.value[prefix]) return levels.value[prefix]
		const response = await call('cf/browse', { prefix }, { fallback: 'Couldn’t list the commands' })
		if (response?.result) levels.value[prefix] = response.result
		return response?.result || null
	}

	const getCommand = async (name) => {
		if (details.value[name]) return details.value[name]
		const response = await call('cf/command', { command: name })
		if (response?.result) details.value[name] = response.result
		return response?.result || null
	}

	// Runs a command for a page that knows what it's asking for, such as
	// exec('dns dnssec edit', { zone, flags: { status: 'active' } }). Throws like useCfApi's
	// call(): CfApiError with Cloudflare's message, or a 400 for input cf wouldn't accept.
	const exec = async (name, input = {}, { fallback } = {}) =>
		noteChange(await call('cf/run', { ...input, command: name }, { fallback }))

	// Resolves to Cloudflare's envelope with `request` (what was sent) whether or not
	// Cloudflare accepted it; throws only when the request couldn't be built or sent, such as
	// a missing required flag (HTTP 400, shown next to the form).
	const run = async (payload) => {
		try {
			return noteChange(await call('cf/run', payload))
		} catch (error) {
			if (error instanceof CfApiError) return error.response
			throw error
		}
	}

	return { search, browse, getCommand, exec, run }
}
