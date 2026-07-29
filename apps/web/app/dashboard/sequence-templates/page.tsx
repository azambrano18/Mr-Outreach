import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';
import type { SequenceTemplateSummary } from '../../../lib/sequence-template-types';
import { SequenceTemplatesList } from './sequence-templates-list';

export default async function SequenceTemplatesPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  if (!currentUser.permissions.includes('sequence_templates.read_own')) {
    return <AccessDenied />;
  }

  const templates = await apiFetch<SequenceTemplateSummary[]>('/me/sequence-templates');

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Plantillas</h1>
          <p className="text-sm text-slate-500">
            Contenido reutilizable de prospección: 3 envíos, variables y programación, asociado a una cuenta de
            correo.
          </p>
        </div>
        {currentUser.permissions.includes('sequence_templates.create_own') && (
          <Link
            href="/dashboard/sequence-templates/new"
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            Nueva plantilla
          </Link>
        )}
      </div>

      <SequenceTemplatesList templates={templates} />
    </div>
  );
}
