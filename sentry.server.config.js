import { hostname } from 'node:os'
import * as Sentry from '@sentry/nuxt'
import {
	collectsRequestBody,
	getSentryDsn,
	isSentryTestRuntime,
	sanitizeSentrySpan,
	sentryOptions
} from './shared/utils/sentry'

// The container's hostname, which GlitchTip's log list shows as Host. HOSTNAME wins when the
// platform sets a friendlier one.
const host = process.env.SENTRY_HOST_NAME || process.env.HOSTNAME || hostname()

Sentry.init({
	...sentryOptions({
		dsn: getSentryDsn(),
		environment: process.env.NODE_ENV || 'development',
		runtime: 'server',
		host,
		disabled: isSentryTestRuntime() || process.env.SENTRY_DISABLED === 'true',
		consoleLogs: Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
		// Request bodies are read only for routes that carry no credentials.
		http: Sentry.httpIntegration({ ignoreRequestBody: (url) => !collectsRequestBody(url) })
	}),
	beforeSendSpan: Sentry.withStaticSpan(sanitizeSentrySpan)
})
