import { createError } from 'h3'
import { readJsonBody } from '../utils/readJsonBody'
import { cfCommand } from '../utils/cfCommand'
import { appTokenPolicies, pickAllPermissionGroups, pickAppPermissionGroups } from '../utils/tokenSetup'
import { addConnection, describeConnection, userConnections } from '../utils/connections'
import { connectionLabel } from '../utils/connectionLabel'
import { readToken } from '../utils/tokenCheck'

// Makes DNS Manager's token from a one-off token that can create tokens (Cloudflare's "Create
// Additional Tokens" template, User API Tokens Edit), so nobody has to pick 20 permissions by hand.
// Body: { token: <the one-off token>, action: 'preview' | 'create', coverage: 'app' | 'all' }.
// - preview answers, for each coverage, what the new token would get as Cloudflare names it today:
//   { app: { permissions: [{ name, scope, use }], missing: [{ name, access, use }] },
//     all: { permissions: [{ name, scope }] } }. `app` is every permission DNS Manager's pages use,
//   `all` every account and zone permission, so any Console command works.
// - create makes a user token called "DNS Manager" with the chosen permissions on every account and
//   zone, checks it can list zones, adds it to the signed-in account as a connection, then deletes
//   the one-off token. Answers { connection, name, coverage, permissions, missing, setupDeleted };
//   the new token itself never leaves the server.

const TOKEN_NAME = 'DNS Manager'
// A new token can take a moment to work everywhere.
const CHECK_DELAYS_MS = [0, 1000, 2500]

const badRequest = (statusMessage) => createError({ statusCode: 400, message: statusMessage })
const failure = (message, reason) => ({ success: false, reason, errors: [{ message }], messages: [], result: null })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const describe = ({ name, scope, use }) => ({ name, scope, use })

export default defineEventHandler(async (event) => {
	try {
		const body = await readJsonBody(event)
		const apiKey = readToken(body?.token)
		const action = body.action === 'create' ? 'create' : body.action === 'preview' ? 'preview' : ''
		if (!action) throw badRequest('Say whether to preview or create the token.')
		const coverage = body.coverage === 'all' ? 'all' : 'app'

		const groups = await cfCommand({ apiKey, command: 'user tokens permission-groups list' })
		if (!groups?.success) {
			return failure(
				'This token can’t create other tokens. Make one from Cloudflare’s Create Additional Tokens template, or paste a token with DNS Manager’s permissions.',
				'cannot_create'
			)
		}
		const app = pickAppPermissionGroups(groups.result)
		const all = pickAllPermissionGroups(groups.result)
		if (!app.picked.length) {
			return failure('Cloudflare didn’t offer any of the permissions DNS Manager uses.', 'no_permissions')
		}

		if (action === 'preview') {
			return {
				success: true,
				errors: [],
				messages: [],
				result: {
					app: { permissions: app.picked.map(describe), missing: app.missing },
					all: { permissions: all.map(describe) }
				}
			}
		}

		const picked = coverage === 'all' ? all : app.picked
		const missing = coverage === 'all' ? [] : app.missing

		// The one-off token's own ID, so it can delete itself once the new token works.
		const verify = await cfCommand({ apiKey, command: 'user tokens verify' })
		const setupId = verify?.success ? verify.result?.id : ''

		const created = await cfCommand({
			apiKey,
			command: 'user tokens create',
			body: { name: TOKEN_NAME, policies: appTokenPolicies(picked) }
		})
		const token = created?.success ? created.result?.value : ''
		if (!token) {
			return created?.success === false
				? created
				: failure('Cloudflare didn’t return the new token.', 'create_failed')
		}

		let works = false
		for (const delay of CHECK_DELAYS_MS) {
			await sleep(delay)
			const zones = await cfCommand({ apiKey: token, command: 'zones list', flags: { 'per-page': 1 } }).catch(
				() => null
			)
			if (zones?.success) {
				works = true
				break
			}
		}

		const removeCreated = async () => {
			if (!created.result?.id) return false
			const removed = await cfCommand({
				apiKey,
				command: 'user tokens delete',
				args: { 'token-id': created.result.id }
			}).catch(() => null)
			return Boolean(removed?.success)
		}
		if (!works) {
			const removed = await removeCreated()
			return failure(
				`Cloudflare created a token, but it couldn’t list your zones. No connection was added. Your set-up token still works.${removed ? '' : ' Delete the unused DNS Manager token in Cloudflare before trying again.'}`,
				'verification_failed'
			)
		}

		const userId = event.context.user.id
		let id
		try {
			id = addConnection(userId, {
				token,
				label: await connectionLabel(token),
				cfTokenId: created.result?.id || null
			})
		} catch {
			const removed = await removeCreated()
			return failure(
				`The new connection couldn’t be saved. Your set-up token still works.${removed ? '' : ' Delete the unused DNS Manager token in Cloudflare before trying again.'}`,
				'save_failed'
			)
		}
		// Save the working token before revoking the only credential that could recreate it.
		let setupDeleted = false
		if (setupId) {
			const removed = await cfCommand({
				apiKey,
				command: 'user tokens delete',
				args: { 'token-id': setupId }
			}).catch(() => null)
			setupDeleted = Boolean(removed?.success)
		}
		const connection = describeConnection(userConnections(userId).find((row) => row.id === id))
		return {
			success: true,
			errors: [],
			messages: [],
			result: { connection, name: TOKEN_NAME, coverage, permissions: picked.map(describe), missing, setupDeleted }
		}
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: error?.message || 'Unknown error'
		})
	}
})
