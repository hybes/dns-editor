// Cloudflare facts that the pages and the server routes both rely on.

export const API_TOKENS_URL = 'https://dash.cloudflare.com/profile/api-tokens'

// Error codes for a malformed, expired or revoked token on ordinary API calls. Missing
// permissions use other codes (such as 10000) and are handled by the page that asked.
export const TOKEN_REJECTED_CODES = new Set([6003, 6111, 9109])
