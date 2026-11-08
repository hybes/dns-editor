import { useRuntimeConfig } from '#imports'
import * as Sentry from '@sentry/nuxt'
import {
	browserSentrySettings,
	isVisitorNetworkFailure,
	sanitizeSentrySpan,
	sentryOptions
} from './shared/utils/sentry'

// Off unless the page is served from a real (non-local) address, or NUXT_PUBLIC_SENTRY_FORCE=1.
// Headless and scripted browsers never report.
const settings = browserSentrySettings(useRuntimeConfig().public)
const options = sentryOptions({
	...settings,
	runtime: 'browser',
	consoleLogs: Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] })
})

// Requests whose fetch() rejected, from the fetch breadcrumbs. Nuxt's payload loader and @nuxt/icon
// log a line of their own for such a failure, without the error, so the line is matched to a request
// that failed just before it.
const unanswered = []
const failedJustBefore = (matches) =>
	!navigator.onLine || unanswered.some((request) => Date.now() - request.at < 10_000 && matches(request.url))
const isPayloadRequest = (url) => url.origin === location.origin && url.pathname.endsWith('/_payload.json')
// @nuxt/icon asks our icon endpoint first and the public Iconify API after it.
const isIconRequest = (url) =>
	(url.origin === location.origin && url.pathname.startsWith('/api/_nuxt_icon/')) || url.host === 'api.iconify.design'

// The visitor's connection, not a fault of ours: these lines go to GlitchTip at info.
function relevelLog(log) {
	if (!['warn', 'error', 'fatal'].includes(log.level)) return log
	const message = String(log.message ?? '')
	const outside =
		(/^\[NUXT_E7002\]/.test(message) && failedJustBefore(isPayloadRequest)) ||
		(message.startsWith('[Icon] failed to load icon ') && failedJustBefore(isIconRequest)) ||
		// A slow connection: the icon still appears when it arrives.
		/^\[Icon\] loading icon `[^`]+` timed out after \d+ms$/.test(message)
	return outside ? { ...log, level: 'info', severityNumber: undefined } : log
}

Sentry.init({
	...options,
	beforeBreadcrumb: (breadcrumb, hint) => {
		try {
			if (
				breadcrumb.category === 'fetch' &&
				breadcrumb.level === 'error' &&
				typeof breadcrumb.data?.url === 'string' &&
				isVisitorNetworkFailure(hint?.data)
			) {
				unanswered.push({ url: new URL(breadcrumb.data.url, location.origin), at: Date.now() })
				if (unanswered.length > 20) unanswered.shift()
			}
		} catch {
			// An unreadable URL must not stop the breadcrumb.
		}
		return options.beforeBreadcrumb(breadcrumb)
	},
	beforeSendLog: (log) => options.beforeSendLog(relevelLog(log)),
	beforeSendSpan: Sentry.withStaticSpan(sanitizeSentrySpan)
})
