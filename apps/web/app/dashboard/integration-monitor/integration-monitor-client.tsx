'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IntegrationCommand, IntegrationEvent, IntegrationSummary } from '@outreach/shared-types';
import { JsonViewer } from '../../../components/integration/json-viewer';
import { StatusBadge, StatusTone } from '../../../components/integration/status-badge';

type Tab = 'resumen' | 'comandos' | 'eventos';

const COMMAND_STATUS_TONE: Record<IntegrationCommand['status'], StatusTone> = {
  REQUESTED: 'neutral',
  ACCEPTED: 'warning',
  PROCESSING: 'warning',
  COMPLETED: 'good',
  FAILED: 'error',
  CANCELLED: 'neutral',
  TIMEOUT: 'error',
};

const EVENT_STATUS_TONE: Record<IntegrationEvent['status'], StatusTone> = {
  RECEIVED: 'neutral',
  PROCESSED: 'good',
  FAILED: 'error',
};

export function IntegrationMonitorClient({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<Tab>('resumen');
  const [summary, setSummary] = useState<IntegrationSummary | null>(null);
  const [commands, setCommands] = useState<IntegrationCommand[]>([]);
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [selectedCommand, setSelectedCommand] = useState<IntegrationCommand | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<IntegrationEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    const response = await fetch('/api/integration/summary');
    if (response.ok) setSummary(await response.json());
  }, []);

  const loadCommands = useCallback(async () => {
    const response = await fetch('/api/integration/commands');
    if (response.ok) setCommands(await response.json());
  }, []);

  const loadEvents = useCallback(async () => {
    const response = await fetch('/api/integration/events');
    if (response.ok) setEvents(await response.json());
  }, []);

  useEffect(() => {
    void loadSummary();
    void loadCommands();
    void loadEvents();
  }, [loadSummary, loadCommands, loadEvents]);

  async function openCommand(commandId: string): Promise<void> {
    const response = await fetch(`/api/integration/commands/${commandId}`);
    if (response.ok) {
      const body = await response.json();
      setSelectedCommand(body.command);
      setSelectedEvents(body.events);
    }
  }

  async function advanceCommand(commandId: string, mode: 'ONE' | 'ALL'): Promise<void> {
    setError(null);
    setLoading(commandId);
    try {
      const response = await fetch(`/api/integration/commands/${commandId}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo avanzar el comando.');
        return;
      }
      await Promise.all([loadCommands(), loadSummary(), openCommand(commandId)]);
    } finally {
      setLoading(null);
    }
  }

  async function reprocessEvent(eventId: string): Promise<void> {
    setLoading(eventId);
    try {
      await fetch(`/api/integration/events/${eventId}/reprocess`, { method: 'POST' });
      await loadEvents();
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Monitor de integración</h1>
      <p className="text-sm text-slate-500">
        Inspecciona el Outbox (comandos) y el Inbox (eventos) del motor simulado — no aplica a envíos reales.
      </p>

      <div className="flex gap-2 border-b border-slate-200">
        {(['resumen', 'comandos', 'eventos'] as Tab[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`px-3 py-2 text-sm font-medium capitalize ${
              tab === value ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {tab === 'resumen' && summary && (
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:grid-cols-2">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Modo del motor</span>
            <p className="text-sm text-slate-800">{summary.mailEngineMode}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Total de comandos</span>
            <p className="text-sm text-slate-800">{summary.totalCommands}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Comandos por estado</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(summary.commandsByStatus).map(([status, count]) => (
                <StatusBadge key={status} label={`${status}: ${count}`} tone="neutral" />
              ))}
            </div>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Total de eventos</span>
            <p className="text-sm text-slate-800">{summary.totalEvents}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Eventos por estado</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(summary.eventsByStatus).map(([status, count]) => (
                <StatusBadge key={status} label={`${status}: ${count}`} tone="neutral" />
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'comandos' && (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Recurso</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Creado</th>
                  <th className="px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((command) => (
                  <tr key={command.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-mono">{command.commandType}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {command.aggregateType} / {command.aggregateId.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge label={command.status} tone={COMMAND_STATUS_TONE[command.status]} />
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {new Date(command.createdAt).toLocaleString('es-CL')}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void openCommand(command.commandId)}
                          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:border-brand-300 hover:text-brand-700"
                        >
                          Ver JSON
                        </button>
                        {canManage && !['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(command.status) && (
                          <button
                            type="button"
                            disabled={loading === command.commandId}
                            onClick={() => void advanceCommand(command.commandId, 'ALL')}
                            className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:border-emerald-300 hover:text-emerald-700"
                          >
                            {loading === command.commandId ? '…' : 'Avanzar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {commands.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                      Sin comandos todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selectedCommand && (
            <JsonViewer
              value={{ command: selectedCommand, events: selectedEvents }}
              fileName={`${selectedCommand.commandId}.json`}
            />
          )}
        </div>
      )}

      {tab === 'eventos' && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Origen</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Recibido</th>
                {canManage && <th className="px-3 py-2">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 font-mono">{event.eventType}</td>
                  <td className="px-3 py-2 text-slate-500">{event.origin}</td>
                  <td className="px-3 py-2">
                    <StatusBadge label={event.status} tone={EVENT_STATUS_TONE[event.status]} />
                  </td>
                  <td className="px-3 py-2 text-slate-500">{new Date(event.receivedAt).toLocaleString('es-CL')}</td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={loading === event.eventId}
                        onClick={() => void reprocessEvent(event.eventId)}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:border-brand-300 hover:text-brand-700"
                      >
                        {loading === event.eventId ? '…' : 'Reprocesar'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    Sin eventos todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
