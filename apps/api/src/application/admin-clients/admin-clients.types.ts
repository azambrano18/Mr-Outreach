import { ManagedClientStatus } from '../../domain/client/managed-client.entity';

export type ClientConfigurationStatus = 'CONFIGURACION_INCOMPLETA' | 'CON_INCIDENCIAS' | 'CONFIGURADO';

/** Listado local puro de ManagedClient con su estado de configuración. */
export interface AdminClientOverview {
  id: string;
  name: string;
  legalName: string | null;
  internalCode: string | null;
  industry: string | null;
  status: ManagedClientStatus;
  configurationStatus: ClientConfigurationStatus;
  domainCount: number;
  mailboxCount: number;
  assignedExecutiveCount: number;
}

export interface AdminClientsListResult {
  available: boolean;
  clients: AdminClientOverview[];
}
