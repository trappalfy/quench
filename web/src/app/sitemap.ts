import type { MetadataRoute } from "next";

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
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) return [];

  return ROUTES.map((route) => ({
    url: new URL(route || "/", base).toString(),
    changeFrequency: route === "" || route === "/app" ? "hourly" : "weekly",
    priority: route === "" ? 1 : 0.7,
  }));
}
