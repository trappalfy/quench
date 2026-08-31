import { Nav } from "@/components/Nav";
import { HookBuilder } from "@/components/builder/HookBuilder";
import { serverClient } from "@/lib/client";

export const revalidate = 10;

export const metadata = {
  title: "Hook builder — Quench",
  description:
    "Compose the five blocks, see what the stack costs a buyer, and check the config against the hook's own validation before spending gas.",
};

export default async function Builder() {
  // The head block is the only thing this page reads from the chain. Everything
  // below it is arithmetic that runs in the browser.
  const head = await serverClient.getBlockNumber().catch(() => undefined);

  return (
    <>
      <Nav head={head} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="q-label">/ builder</p>
        <h1 className="q-display mt-2 text-4xl sm:text-5xl lg:text-6xl">
          Compose the
          <br />
          rules first
        </h1>
        <p className="q-lead mt-4 max-w-2xl">
          Five blocks, numbered the way the contract names them. Everything on this
          page is computed here in your browser by the same arithmetic the contract
          executes, and checked against the same validation the contract applies.
          Nothing is sent anywhere until you launch.
        </p>

        <div className="mt-10">
          <HookBuilder />
        </div>
      </main>
    </>
  );
}
