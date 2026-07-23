import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../../lib/session';
import { CreateVariableForm } from './create-variable-form';

export default async function NewVariablePage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('variables.create')) {
    redirect('/dashboard/variables');
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Nueva variable</h1>
      <CreateVariableForm />
    </div>
  );
}
