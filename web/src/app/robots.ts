import type { MetadataRoute } from "next";
import { INDEXABLE, SITE_URL } from "@/lib/site";

/**
 * Crawlers are welcome on the production site and nowhere else.
 *
 * A preview deployment is the same site at a throwaway address. Letting it be
 * indexed puts a second copy of Quench in the results that stops existing on
 * the next push, and the two compete for the same name.
 */
export default function robots(): MetadataRoute.Robots {
  if (!INDEXABLE) return { rules: { userAgent: "*", disallow: "/" } };

  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", SITE_URL).toString(),
    host: SITE_URL,
  };
}
