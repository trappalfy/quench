import type { MetadataRoute } from "next";

/**
 * Search engines are told to stay away until Quench has its own domain.
 *
 * A deployment reachable only at its `*.vercel.app` hostname is the same site
 * at the wrong address. Letting it be indexed means that when the real domain
 * arrives, the results already point somewhere else — and the first thing a
 * search for a launchpad's name should not turn up is a second copy of it.
 *
 * Setting NEXT_PUBLIC_SITE_URL is what flips this open, which makes indexing a
 * decision someone made rather than a thing that happened.
 */
export default function robots(): MetadataRoute.Robots {
  const live = Boolean(process.env.NEXT_PUBLIC_SITE_URL);

  return {
    rules: live
      ? { userAgent: "*", allow: "/" }
      : { userAgent: "*", disallow: "/" },
    ...(live
      ? { sitemap: new URL("/sitemap.xml", process.env.NEXT_PUBLIC_SITE_URL).toString() }
      : {}),
  };
}
