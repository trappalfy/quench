import type { MetadataRoute } from "next";
import { INDEXABLE, SITE_URL } from "@/lib/site";

/**
 * The pages that exist whether or not anyone has launched anything.
 *
 * Token pages are deliberately absent. There is no database behind this site,
 * so listing them would mean reading the registry at build time and shipping a
 * sitemap that is stale by the next launch. The feed at /app links every one of
 * them and is re-read on request, which is what a crawler should follow.
 */
const ROUTES = [
  "",
  "/app",
  "/builder",
  "/launch",
  "/hooks",
  "/docs",
  "/methodology",
  "/terms",
  "/privacy",
];

export default function sitemap(): MetadataRoute.Sitemap {
  // A preview deployment publishes no sitemap, for the same reason it asks
  // not to be crawled.
  if (!INDEXABLE) return [];

  return ROUTES.map((route) => ({
    url: new URL(route || "/", SITE_URL).toString(),
    changeFrequency: route === "" || route === "/app" ? "hourly" : "weekly",
    priority: route === "" ? 1 : 0.7,
  }));
}
