/**
 * Where Quench lives.
 *
 * A constant rather than a dashboard field. The canonical address decides what
 * every og:image resolves against, what the sitemap is built from, and whether
 * crawlers are welcome — three things worth being able to read in a diff and
 * find in a commit, instead of in a setting nobody can see from the code.
 *
 * NEXT_PUBLIC_SITE_URL still overrides it, for a fork or a second deployment
 * that is legitimately somewhere else.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://quench.click";

/**
 * Whether this deployment should be in search results.
 *
 * Only the production one. A preview build is the same site at a throwaway
 * address, and indexing it would put a copy of Quench in the results that
 * stops existing on the next push. Vercel marks previews noindex by its own
 * header too; this makes the intent visible in the repository rather than
 * depending on the host to keep doing it.
 */
export const INDEXABLE = process.env.VERCEL_ENV !== "preview";
