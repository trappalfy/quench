/**
 * The hook's arithmetic, re-exported rather than reimplemented.
 *
 * `ts/src/simulate.ts` mirrors `src/lib/BlockMath.sol` statement for statement
 * and a differential test checks the two against the same 2,000 vectors. The
 * interface quotes what a trade costs, so it has to quote it from there — a
 * second copy of these formulas in the web app would drift, and the first thing
 * a user would notice is a number that did not match what the chain charged.
 */
export * from "../../../ts/src/simulate";
