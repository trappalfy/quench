/**
 * A token's life, left to right, hot to cold.
 *
 * The temperature is the argument: what starts as a config somebody is still
 * arguing about ends as a rule nobody can touch. Each stage says what the hook
 * is doing at that moment, so the band explains the product rather than
 * decorating it.
 */
const STAGES = [
  {
    n: "01",
    name: "Compose",
    hook: "Nothing on chain yet. The config is a struct in your browser.",
    t: 0,
  },
  {
    n: "02",
    name: "Launch",
    hook: "The launchpad stages the config and initializes the pool in one transaction. This is the last moment it can be changed.",
    t: 0.2,
  },
  {
    n: "03",
    name: "Pool opens",
    hook: "The hook records the block. Anti-snipe starts counting from here, not from the launch.",
    t: 0.4,
  },
  {
    n: "04",
    name: "Guard window",
    hook: "Buys are capped against the in-range reserve and pay the surcharge. Surge is loudest here, because a thin new pool is easy to move.",
    t: 0.6,
  },
  {
    n: "05",
    name: "Window closes",
    hook: "The cap and the surcharge stop. Surge, burn, LP rewards and the pot carry on for as long as the pool exists.",
    t: 0.8,
  },
  {
    n: "06",
    name: "Set",
    hook: "Nothing further happens to the rules. There is no function that would change them and no address that could call one.",
    t: 1,
  },
];

export function LaunchPath() {
  return (
    <div className="grid gap-px border border-line bg-line md:grid-cols-3 lg:grid-cols-6">
      {STAGES.map((s) => (
        <div key={s.n} className="bg-panel p-4">
          {/* The bar carries the temperature; the text does not need to repeat
              it. color-mix runs the same scale the token marks use. */}
          <div
            className="h-1 w-full"
            style={{
              background: `color-mix(in oklab, var(--color-cyan) ${s.t * 100}%, var(--color-amber))`,
            }}
          />
          <div className="mt-3 flex items-baseline justify-between">
            <span className="q-display-sm text-base">{s.name}</span>
            <span className="q-label">{s.n}</span>
          </div>
          <p className="mt-2 text-[12px] text-dim">{s.hook}</p>
        </div>
      ))}
    </div>
  );
}
