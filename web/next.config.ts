import path from "node:path";
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

  /**
   * The repo root, not `web/`. The interface quotes what a trade costs from
   * `ts/src/simulate.ts`, which is the file the differential test checks
   * against Solidity — a second copy inside `web/` would drift, and the first
   * sign of it would be a quoted number the chain did not honour.
   *
   * Turbopack will not resolve above its root, and TypeScript is happy to, so
   * without this the import typechecks and then fails at build.
   */
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
