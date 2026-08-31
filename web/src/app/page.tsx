export default function Home() {
  return (
    <main className="min-h-screen q-grid p-8">
      <p className="q-label">/ quench</p>
      <h1
        className="font-display text-6xl uppercase leading-[0.95] text-text"
        style={{ fontStretch: "125%" }}
      >
        Build the hook.
        <br />
        <span className="text-cyan">Then quench it.</span>
      </h1>
      <p className="mt-6 max-w-md text-dim">
        Scaffold only. Read layer wired, nothing rendered from chain yet.
      </p>
    </main>
  );
}
