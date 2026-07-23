import { redirect } from 'next/navigation';
import type { SequenceSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { AccessDenied } from '../../access-denied';
import { SequencesList } from '../../../../components/sequences/sequences-list';

/**
 * Always re-fetches server-side instead of reusing Next.js's client Router
 * Cache for this segment — without this, arriving here via a plain <Link>
 * shortly after publishing a sequence (e.g. from the wizard's "Ver mis
 * secuencias" link) can show the payload cached from an earlier visit,
 * missing the just-published sequence.
 */
export const dynamic = 'force-dynamic';

/** "Secuencias" — Crear / Borradores / Programadas / En ejecución / Historial, per the new wizard-based module. */
export default async function MySequencesPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('sequences.manage.own')) {
    return <AccessDenied />;
  }

  let sequences: SequenceSummary[] = [];
  let loadError: string | null = null;
  try {
    sequences = await apiFetch<SequenceSummary[]>('/me/sequences');
  } catch (error) {
    loadError = error instanceof ApiError ? error.message : 'No se pudieron cargar las secuencias.';
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Secuencias</h1>
        <p className="text-sm text-slate-500">
          Crea y da seguimiento a tus secuencias de prospección: borradores, programadas, en ejecución e historial.
        </p>
      </div>
      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : (
        <SequencesList sequences={sequences} currentUserId={currentUser.id} />
      )}
    </div>
  );
}
