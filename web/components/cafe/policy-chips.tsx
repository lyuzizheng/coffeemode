"use client";

export function policyOptions(values: readonly string[], labels: Record<string, string>) {
  return values.map((value) => ({ value, label: labels[value] ?? value }));
}

export function PolicyChips<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected === option.value}
            onClick={() => onSelect(option.value)}
            className="group cm-focus relative -my-1 flex min-h-11 min-w-11 items-center justify-center"
          >
            <span
              className={`flex h-9 items-center rounded-sm border px-3 text-xs font-medium transition-colors duration-150 ${
                selected === option.value
                  ? "border-secondary bg-secondary text-secondary-foreground"
                  : "border-border bg-surface-secondary text-foreground group-hover:bg-surface-tertiary"
              }`}
            >
              {option.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
