const TONE_CLASSES = {
  good: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
  neutral: 'bg-slate-100 text-slate-600',
} as const;

export type StatusTone = keyof typeof TONE_CLASSES;

/** Shared pill following the color convention already used ad-hoc across the app (emerald=good, amber=in-progress, red=error, slate=neutral). */
export function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {label}
    </span>
  );
}
