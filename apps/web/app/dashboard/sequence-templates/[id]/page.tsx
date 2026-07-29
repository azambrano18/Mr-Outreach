import { notFound, redirect } from 'next/navigation';
import { ApiError, apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { AccessDenied } from '../../access-denied';
import type { SequenceTemplateDetail } from '../../../../lib/sequence-template-types';
import { SequenceTemplateEditor } from './sequence-template-editor';

export default async function SequenceTemplateDetailPage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  if (!currentUser.permissions.includes('sequence_templates.read_own')) {
    return <AccessDenied />;
  }

  let template: SequenceTemplateDetail;
  try {
    template = await apiFetch<SequenceTemplateDetail>(`/me/sequence-templates/${params.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 py-4">
      <SequenceTemplateEditor
        initialTemplate={template}
        canUpdate={currentUser.permissions.includes('sequence_templates.update_own')}
        canPublish={currentUser.permissions.includes('sequence_templates.publish_own')}
        canArchive={currentUser.permissions.includes('sequence_templates.archive_own')}
      />
    </div>
  );
}
