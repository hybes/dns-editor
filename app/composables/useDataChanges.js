// When Cloudflare data last changed in a way the pages' own caches don't track, such as a
// command run in the Console. Anything cached before then counts as stale, so the next load
// fetches it again instead of showing what was there before the change.
export function useDataChanges() {
	const changedAt = useState('cf-data-changed-at', () => 0)

	return {
		markChanged: () => {
			changedAt.value = Date.now()
		},
		// Whether a cache entry fetched at `fetchedAt` can still be used within `ttl` ms.
		isFresh: (fetchedAt, ttl) => Boolean(fetchedAt) && fetchedAt > changedAt.value && Date.now() - fetchedAt < ttl
	}
}
