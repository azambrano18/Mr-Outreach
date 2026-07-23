'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function TemplateActions({
  templateId,
  active,
  canDuplicate,
  canArchive,
  canDelete,
}: {
  templateId: string;
  active: boolean;
  canDuplicate: boolean;
  canArchive: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function run(action: string, request: () => Promise<Response>): Promise<void> {
    setLoading(action);
    try {
      await request();
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canDuplicate && (
        <button
          type="button"
          disabled={loading !== null}
          onClick={() =>
            run('duplicate', () =>
              fetch(`/api/templates/${templateId}/duplicate`, { method: 'POST' }),
            )
          }
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
        >
          {loading === 'duplicate' ? '…' : 'Duplicar'}
        </button>
      )}
      {canArchive && (
        <button
          type="button"
          disabled={loading !== null}
          onClick={() =>
            run(active ? 'archive' : 'restore', () =>
              fetch(`/api/templates/${templateId}/${active ? 'archive' : 'restore'}`, {
                method: 'POST',
              }),
            )
          }
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
        >
          {loading === 'archive' || loading === 'restore' ? '…' : active ? 'Archivar' : 'Restaurar'}
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => {
            if (
              !window.confirm(
                '¿Eliminar este texto? Esta acción no se puede deshacer desde el panel.',
              )
            ) {
              return;
            }
            void run('delete', () => fetch(`/api/templates/${templateId}`, { method: 'DELETE' }));
          }}
          className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
        >
          {loading === 'delete' ? '…' : 'Eliminar'}
        </button>
      )}
    </div>
  );
}
