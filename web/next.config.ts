import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `next dev` and `next build` both write to .next, and running one while the
   * other is up corrupts the dev server's manifests — it starts serving 500s
   * with no obvious cause. Giving the build its own directory removes the
   * collision rather than relying on remembering not to.
   *
   * The `build` script sets NEXT_DIST_DIR; dev keeps the default.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
