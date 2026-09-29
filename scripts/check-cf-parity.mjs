#!/usr/bin/env node
// Checks that this app builds the same request as the cf CLI for every command in
// server/cf/catalogue.json. For each command it fills in every argument and flag with sample
// values, asks cf for `--dry-run` output, builds the request with server/utils/cfCommand.js,
// and compares the method, URL, query string and JSON body. Run it after `npm run cf:sync`:
//
//   npm run cf:check                  every command
//   npm run cf:check -- "dns records" commands starting with a prefix
//
// It downloads the cf release the catalogue was built from (npx), and sends nothing to
// Cloudflare: dry runs don't, and the IDs it uses need no look-ups.

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogue = JSON.parse(readFileSync(join(root, 'server/cf/catalogue.json'), 'utf8'))
const prefix = process.argv[2] || ''

const ZONE = '023e105f4ecef8ad9ca31a8372d0c353'
const ACCOUNT = 'aaaabbbbccccddddeeeeffff00001111'
const CONCURRENCY = 8

// Differences that come from cf itself rather than from this app, as of cf 1.0.0-beta.5.
const KNOWN = {
	// cf sends an empty string for an unset choice whose first option is "".
	'load-balancers searches list': 'query',
	// cf sends inline JSON for --params as a string; the app sends it as JSON.
	'workflows instances create': 'body',
	// cf reads a positional called "version" as its own --version flag.
	'zero-trust dlp datasets upload': 'url'
}

// The server code uses Nitro's extensionless imports and a JSON import; teach Node both.
const serverUrl = pathToFileURL(join(root, 'server')).href
registerHooks({
	resolve(specifier, context, next) {
		if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) {
			try {
				return next(`${specifier}.js`, context)
			} catch {
				// Fall through to the specifier as written.
			}
		}
		return next(specifier, context)
	},
	load(url, context, next) {
		if (url.endsWith('.json')) {
			const source = readFileSync(fileURLToPath(url), 'utf8')
			return { format: 'module', source: `export default ${source}`, shortCircuit: true }
		}
		// The server files are ES modules, though package.json doesn't say so.
		if (url.startsWith(serverUrl)) return next(url, { ...context, format: 'module' })
		return next(url, context)
	}
})

const { buildCfRequest, describeCfRequest } = await import(pathToFileURL(join(root, 'server/utils/cfCommand.js')).href)

// npx downloads cf once; its binary is then called directly, which is far quicker than npx.
console.log(`Fetching cf@${catalogue.version}…`)
const { stdout: cfPath } = await run('npx', ['--yes', '-p', `cf@${catalogue.version}`, '-c', 'command -v cf'], {
	timeout: 300_000
})
const cf = cfPath.trim()

const sample = (input, index) => {
	if (input.format === 'objects') return `[{"k":"v${index}"}]`
	if (input.format === 'json') return `{"k":${index}}`
	if (input.enum?.length) return input.array ? [input.enum[0]] : input.enum[0]
	if (input.type === 'number') return input.array ? [index + 1] : index + 1
	if (input.type === 'boolean') return true
	return input.array ? [`a${index}`, `b${index}`] : `v${index}`
}

// Every flag gets a value unless it can't be combined with one already chosen.
const inputsFor = (command) => {
	const args = {}
	const flags = {}
	const line = command.command.split(' ')
	command.args.forEach((arg, index) => {
		const value = sample(arg, index)
		args[arg.name] = value
		line.push(...(Array.isArray(value) ? value : [value]).map(String))
	})
	command.flags.forEach((flag, index) => {
		const clashes = (command.rules?.conflicts || []).some(
			([name, others]) =>
				(name === flag.name && others.some((other) => other in flags)) ||
				(others.includes(flag.name) && name in flags)
		)
		if (clashes) return
		const value = sample(flag, index + 10)
		flags[flag.name] = value
		if (flag.type === 'boolean' && !flag.format) line.push(`--${flag.name}`)
		else for (const item of Array.isArray(value) ? value : [value]) line.push(`--${flag.name}`, String(item))
	})
	let body
	if (
		(command.bodyKind === 'json' && !command.flags.some((flag) => flag.in === 'body')) ||
		command.bodyKind === 'octet-stream'
	) {
		body = '{"k":1}'
		line.push('--body', body)
	}
	if (command.scope === 'zone') line.push('--zone', ZONE)
	line.push('--dry-run')
	return { args, flags, body, line }
}

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const sorted = (value) => {
	if (Array.isArray(value)) return value.map(sorted)
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, sorted(value[key])])
		)
	}
	return value
}
const same = (a, b) => JSON.stringify(sorted(plain(a))) === JSON.stringify(sorted(plain(b)))

const check = async (command) => {
	if (command.handWritten) return { skipped: 'hand-written in cf' }
	if (command.bodyKind === 'multipart') return { skipped: 'file upload' }
	const { args, flags, body, line } = inputsFor(command)

	let theirs
	try {
		const { stdout } = await run(cf, line, {
			env: { ...process.env, CLOUDFLARE_API_TOKEN: 'x', CLOUDFLARE_ACCOUNT_ID: ACCOUNT, NO_COLOR: '1' },
			timeout: 60_000
		})
		theirs = JSON.parse(stdout)
	} catch (error) {
		return {
			skipped: `cf rejected the sample input: ${String(error.stderr || error.message)
				.trim()
				.split('\n')
				.pop()}`
		}
	}

	let ours
	try {
		const request = await buildCfRequest(command, {
			apiKey: 'x',
			zone: ZONE,
			account: ACCOUNT,
			target: command.scope === 'zone' ? 'zone' : 'account',
			args,
			flags,
			body
		})
		ours = describeCfRequest(command, request)
	} catch (error) {
		return { differences: [`the app rejected the input: ${error.statusMessage || error.message}`] }
	}

	const differences = []
	if (theirs.method !== ours.method) differences.push(`method ${theirs.method} ≠ ${ours.method}`)
	if (theirs.url.split('?')[0] !== ours.url.split('?')[0]) differences.push(`url ${theirs.url} ≠ ${ours.url}`)
	if (!same(theirs.query || {}, ours.query || {})) {
		differences.push(`query ${JSON.stringify(plain(theirs.query))} ≠ ${JSON.stringify(ours.query)}`)
	}
	if (theirs.bodyKind === 'json' && !same(theirs.body, ours.body)) {
		differences.push(`body ${JSON.stringify(plain(theirs.body))} ≠ ${JSON.stringify(ours.body)}`)
	}
	return differences.length ? { differences } : { ok: true }
}

const commands = catalogue.commands.filter((command) => command.command.startsWith(prefix))
const results = { ok: 0, known: [], skipped: [], failed: [] }
let next = 0
await Promise.all(
	Array.from({ length: CONCURRENCY }, async () => {
		while (next < commands.length) {
			const command = commands[next++]
			const result = await check(command)
			if (result.ok) results.ok++
			else if (result.skipped) results.skipped.push(`${command.command}: ${result.skipped}`)
			else if (
				KNOWN[command.command] &&
				result.differences.every((text) => text.startsWith(KNOWN[command.command]))
			) {
				results.known.push(command.command)
			} else results.failed.push(`${command.command}: ${result.differences.join('; ')}`)
		}
	})
)

console.log(
	`${results.ok} of ${commands.length} commands match cf@${catalogue.version}; ${results.known.length} known cf differences, ${results.skipped.length} skipped, ${results.failed.length} different.`
)
for (const line of results.skipped) console.log(`  skipped  ${line}`)
for (const line of results.failed) console.log(`  DIFFERS  ${line}`)
process.exitCode = results.failed.length ? 1 : 0
