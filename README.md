# Quench

A token launchpad built on Uniswap v4 hooks, live on Robinhood Chain (4663).

You assemble a hook out of five rules, launch a token behind it, and the rules
stop being editable — by you, by us, by anyone. There is no owner, no upgrade
path and no pause function in any deployed contract. The interface makes that
claim on its front page and prints the `grep` that checks it.

## The five rules

Each is optional, and each is fixed at launch.

| | |
|---|---|
| **Anti-snipe** | For a window of blocks after the pool opens, each buy is capped at a share of the in-range reserve and pays a surcharge |
| **Surge fees** | The fee rises with how deep a single trade bites into liquidity. No oracle and no keeper — arithmetic on the reserve |
| **Auto burn** | A share of the tokens bought goes to the dead address inside the same swap. Reserves are untouched; the buyer receives less |
| **LP rewards** | A share of the incoming ETH is donated to whoever holds in-range liquidity, before the swap sees it |
| **Nth-buy pot** | A share of each qualifying buy accumulates and every Nth buy takes it. The counter is public and advances at most once per block |

The hook returns its fee per swap using v4's override flag, so the pool itself
stores a fee of zero — a detail that costs an interface a wrong number if it
reads `slot0` and believes it.

## Two ways to launch

- **Instant** — a Uniswap v4 pool opens immediately at a price you set. Supply
  that does not fit the opening position is burned, not kept.
- **Curve** — a ten-tranche bonding curve. When the last tranche sells out,
  graduation happens inside that same transaction: the raise opens a v4 pool at
  the final curve price with the hook attached, and the liquidity it creates has
  no removal function.

Supply is fixed at 1,000,000,000 at mint and can only ever shrink.

## Deployed

Chain 4663, block 50,723,079. Addresses and the constructor arguments behind
them are in [`docs/superpowers/specs/2026-08-31-deployed-addresses.md`](docs/superpowers/specs/2026-08-31-deployed-addresses.md).

Source verification on the chain's Blockscout instance has not gone through —
its submission endpoint sits behind a challenge that refuses automated requests.
Until it does, this repository is how you check the bytecode yourself:
[`docs/verifying-sources.md`](docs/verifying-sources.md) has the compiler
settings and the procedure. The site says the same thing rather than implying
the sources are verified.

## Layout

| | |
|---|---|
| `src/` | The contracts. `hook/` holds the v4 hook, `lib/BlockMath.sol` the arithmetic every rule shares |
| `test/` | 150 Foundry tests: unit, fuzz, ten invariants, and a differential run against the TypeScript mirror |
| `script/` | Deployment and seeding. No key ever appears here — the signer comes from the command line |
| `ts/` | `simulate.ts`, a statement-for-statement mirror of `BlockMath.sol`, checked against it on shared vectors |
| `web/` | The interface. Next.js, reading the chain directly, no database and no indexer |

The interface imports `ts/src/simulate.ts` rather than copying it. A second copy
of those formulas would drift, and the first sign of it would be a quoted price
the chain did not honour — so the deployment unit is this repository, not `web/`.

## Running it

```bash
forge test                       # contracts
cd ts && npm install && npm test # the mirror, against Solidity's own vectors
cd web && npm install && npm run dev
```

`web/README.md` covers the interface's own checks, including a Playwright run
that drives a real browser through connect, buy, sell, publish, launch and claim
against an anvil fork.

## What this is not

There has been no audit. The pot is won on a public counter and will be raced.
Nothing here defends against MEV. The rules are immutable, which cuts both ways:
a mistake in a config is permanent too.
