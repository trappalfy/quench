"use client";

import { useEffect, useState } from "react";

/**
 * Copy, and say so.
 *
 * The clipboard is one of the few places a page can fail silently — a denied
 * permission, an insecure origin, an old browser — and a button that looks like
 * it worked when it did not is worse than one that never existed. So the label
 * reports what happened either way.
 */
export function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("done");
        } catch {
          setState("failed");
        }
      }}
      className={`q-label border px-2 py-0.5 hover:text-text ${
        state === "failed" ? "border-fail text-fail" : "border-line text-dim"
      }`}
    >
      {state === "done" ? "copied" : state === "failed" ? "blocked" : label}
    </button>
  );
}
