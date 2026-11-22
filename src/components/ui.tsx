import type { ReactNode } from "react";

/** Control segmentado (radio) accesible. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly (readonly [T, ReactNode])[];
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-lg bg-stage p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, text]) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v)}
            className={`${size === "sm" ? "h-8 text-xs" : "h-9 text-sm"} rounded-md px-2 font-semibold transition-colors ${on ? "bg-raised text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** Interruptor con etiqueta y ayuda opcional. */
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start justify-between gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-muted">{hint}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-10 rounded-full bg-line transition-colors peer-checked:bg-bone peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-bone" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-ink shadow transition-transform peer-checked:translate-x-4 peer-checked:bg-stage" />
      </span>
    </label>
  );
}

export function IconButton({
  label,
  onClick,
  active,
  children,
  className = "",
  disabled,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-40 ${active ? "bg-gold/15 text-gold" : "text-muted hover:bg-raised hover:text-ink"} ${className}`}
    >
      {children}
    </button>
  );
}

export function Panel({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <h3 id={id} className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}
