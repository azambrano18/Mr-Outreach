'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ArchiveRestoreButton({
  variableId,
  active,
}: {
  variableId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick(): Promise<void> {
    setLoading(true);
    try {
      await fetch(`/api/variables/${variableId}/${active ? 'archive' : 'restore'}`, {
        method: 'POST',
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
    >
      {loading ? '…' : active ? 'Archivar' : 'Restaurar'}
    </button>
  );
}
