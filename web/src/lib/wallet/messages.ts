/**
 * Wallet and provider errors, said plainly.
 *
 * A separate module from the context on purpose: this is the only part of the
 * wallet layer the write path needs, and importing it out of a `.tsx` dragged a
 * React component graph into every test that wanted to check an error message.
 *
 * A rejected signature is not a failure and must not read like one — it is the
 * user doing exactly what the button is for. Everything else keeps whatever the
 * wallet said, because a made-up message hides the real cause.
 */
export function describeProviderError(cause: unknown): string {
  const code = (cause as { code?: number })?.code;
  if (code === 4001) return "You rejected the request in your wallet.";
  if (code === -32002) return "Your wallet already has a request open. Finish that one first.";

  const message =
    (cause as { shortMessage?: string })?.shortMessage ??
    (cause as { message?: string })?.message;
  return message ? String(message) : "The wallet did not say what went wrong.";
}
