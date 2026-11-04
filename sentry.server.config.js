import { hostname } from 'node:os'
import * as Sentry from '@sentry/nuxt'
import { collectsRequestBody, sanitizeSentrySpan, sentryOptions, serverSentrySettings } from './shared/utils/sentry'

// The container's hostname, which GlitchTip's log list shows as Host. HOSTNAME wins when the
// platform sets a friendlier one.
const host = process.env.SENTRY_HOST_NAME || process.env.HOSTNAME || hostname()

// Off unless Coolify runs the container (COOLIFY_FQDN, COOLIFY_URL or SOURCE_COMMIT is set), or
// SENTRY_FORCE=1. This covers the API routes and the hourly tidy job, which share this process.
Sentry.init({
	...sentryOptions({
		...serverSentrySettings(),
		runtime: 'server',
		host,
		consoleLogs: Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
		// Request bodies are read only for routes that carry no credentials.
		http: Sentry.httpIntegration({ ignoreRequestBody: (url) => !collectsRequestBody(url) })
	}),
	beforeSendSpan: Sentry.withStaticSpan(sanitizeSentrySpan)
})
