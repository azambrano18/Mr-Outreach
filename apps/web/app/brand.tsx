import Image from 'next/image';

export function BrandMark({ tagline, compact }: { tagline?: string; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Image
        src="/brand-icon.png"
        alt={compact ? 'Mr. Outreach' : ''}
        width={28}
        height={28}
        priority
        className="h-7 w-7 shrink-0"
      />
      {!compact && (
        <span className="text-base font-semibold tracking-tight text-brand-800">Mr. Outreach</span>
      )}
      {!compact && tagline && (
        <>
          <span className="h-4 w-px bg-slate-300" aria-hidden="true" />
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {tagline}
          </span>
        </>
      )}
    </div>
  );
}
