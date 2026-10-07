import { createError } from 'h3'
import { readJsonBody } from '../../utils/readJsonBody'
import { buildCfRequest, describeCfRequest, requireCfCommand, sendCfRequest } from '../../utils/cfCommand'
import { invalidateCfCache } from '../../utils/cfFetch'
import { forgetRenewals } from '../../utils/renewals'
import { refusal } from '../../utils/access'

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)

const GUARDED_COMMANDS = {
	'registrar registrations create':
		'Register domains on the Registrar page, which shows Cloudflare’s quote and checks the price again just before buying.'
}

// Runs any cf API command with the flags the console collected, or with dryRun just describes
// the request, as `cf <command> --dry-run` does.
// Body: { apiKey, command, zone?, account?, accountOfZone?, target?, args?, flags?, body?, files?, dryRun? }
// Answers with Cloudflare's envelope plus `request`, the dry-run description of what was sent.
export default defineEventHandler(async (event) => {
	try {
		const input = await readJsonBody(event)
		const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
		if (!apiKey) throw createError({ statusCode: 400, message: 'API key is required' })
		for (const key of ['args', 'flags', 'files']) {
			if (input[key] !== undefined && !isObject(input[key])) {
				throw createError({ statusCode: 400, message: `${key} must be a JSON object` })
			}
		}
		if (input.target !== undefined && input.target !== 'zone' && input.target !== 'account') {
			throw createError({ statusCode: 400, message: 'target must be zone or account' })
		}

		const command = await requireCfCommand(input.command)
		// Registering a domain is charged and can't be refunded. The Registrar page checks the
		// price again just before it buys, as cf does, so real runs go there instead.
		if (GUARDED_COMMANDS[command.command] && input.dryRun !== true) {
			throw createError({ statusCode: 400, message: GUARDED_COMMANDS[command.command] })
		}
		let request
		try {
			request = await buildCfRequest(command, {
				apiKey,
				zone: input.zone,
				account: input.account,
				accountOfZone: input.accountOfZone,
				target: input.target,
				args: input.args,
				flags: input.flags,
				body: input.body,
				files: input.files
			})
		} catch (error) {
			// Looking up a zone name or the token's account failed at Cloudflare.
			if (error?.envelope) return error.envelope
			throw error
		}
		if (event.context.access?.shared) {
			const reason = refusal({ path: '/api/cf/run', command, request, shared: event.context.access })
			if (reason) throw createError({ statusCode: 403, message: reason, data: { reason: 'not_shared' } })
		}
		const described = describeCfRequest(command, request)

		if (input.dryRun === true) {
			return { success: true, errors: [], messages: [], result: null, request: described, dryRun: true }
		}

		const response = await sendCfRequest(apiKey, command, request)
		// A change made here can affect any page's cached reads, so drop them all for this token.
		if (response?.success && command.method !== 'GET') {
			invalidateCfCache({ apiKey })
			if (command.command.startsWith('registrar ')) forgetRenewals()
		}
		return { ...response, request: described }
	} catch (error) {
		if (error?.statusCode) throw error
		throw createError({
			statusCode: 500,
			message: error?.message || 'Unknown error'
		})
	}
})
