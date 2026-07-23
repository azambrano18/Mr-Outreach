import type {
  MailboxConnectionTestSummary,
  MailboxTestOutcomeStatus,
} from '@outreach/shared-types';

const STATUS_LABELS: Record<MailboxTestOutcomeStatus, string> = {
  CONNECTED: 'Conectado',
  PARTIALLY_CONNECTED: 'Conexión parcial',
  CONNECTION_ERROR: 'Error de conexión',
  ENGINE_UNAVAILABLE: 'Motor no disponible',
};

function protocolLabel(success: boolean, errorCode: string | null): string {
  if (success) return 'OK';
  return errorCode ?? 'Error';
}

export function ConnectionTestHistory({ history }: { history: MailboxConnectionTestSummary[] }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
      <h2 className="text-sm font-medium text-slate-700">Historial de pruebas de conexión</h2>
      {history.length === 0 ? (
        <p className="text-sm text-slate-500">Todavía no se ha ejecutado ninguna prueba.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Resultado</th>
                <th className="py-2 pr-3">IMAP</th>
                <th className="py-2 pr-3">SMTP</th>
                <th className="py-2">Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap font-mono text-xs text-slate-500">
                    {new Date(entry.createdAt).toLocaleString('es-CL')}
                  </td>
                  <td className="py-2 pr-3">{STATUS_LABELS[entry.status]}</td>
                  <td className="py-2 pr-3">
                    {protocolLabel(entry.imapSuccess, entry.imapErrorCode)}
                  </td>
                  <td className="py-2 pr-3">
                    {protocolLabel(entry.smtpSuccess, entry.smtpErrorCode)}
                  </td>
                  <td className="py-2 text-slate-600">{entry.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
