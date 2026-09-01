# Quench — interface

The front end for the launchpad in this repository. Next.js 15 App Router, read
straight from Robinhood Chain (4663), no database and no indexer.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

By default every read goes to the public endpoint for chain 4663. To point the
server at a fork instead, put the endpoint in `web/.env.local`:

```
QUENCH_RPC_URL=http://127.0.0.1:8545
```

The browser never sees that variable. It reads through `/api/rpc`, which is the
only endpoint it knows about and which allows reads only — a wallet broadcasts
its own signed transactions through its own provider, so there is nothing here
that would relay one.

## Checks

| | |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint |
| `npm test` | unit tests: hook config validation, launch arithmetic, trade helpers |
| `npm run verify:reads` | every read on a live chain, cross-checked against a second derivation |
| `npm run e2e` | Playwright against an anvil fork: connect, buy, sell, publish, launch, claim |
| `npm run shots` | screenshots at three widths, plus a horizontal-overflow check |

`verify:reads` and `e2e` need a fork running and `QUENCH_RPC_URL` pointing at it.

## Where the numbers come from

The cost of a trade is quoted from `ts/src/simulate.ts`, imported rather than
copied. That file mirrors `src/lib/BlockMath.sol` statement for statement and a
differential test checks the two against the same vectors — a second copy of the
formulas here would drift, and the first sign of it would be a quoted number the
chain did not honour.

This is why the import reaches outside `web/`, and why two settings exist to let
it: `turbopack.root` in `next.config.ts`, and a `.vercelignore` at the repository
root that keeps `ts/src` in the upload.

## Deploying

The deployment unit is the **repository**, not `web/`, for the reason above. On
Vercel the project's **Root Directory** is `web`, with "include files outside the
root directory" left on.

- **Build command** — Vercel runs `vercel-build`, which is plain
  `next build --turbopack`. The `build` script is for local use only: it
  redirects output to `.next-build` so that building while `next dev` is up does
  not corrupt the dev server's manifests.
- **Environment** — nothing is required. `QUENCH_RPC_URL` falls back to the
  public endpoint for 4663, and the contract addresses are constants, because
  every link between them onchain is immutable.
- **`NEXT_PUBLIC_SITE_URL`** — set this once a real domain is attached. It is
  what makes `robots.txt` allow crawling and what `sitemap.xml` is built from;
  until it is set the site asks not to be indexed, so that the `*.vercel.app`
  address does not become the copy search engines know.
