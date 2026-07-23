export type ClientConfigurationStatus =
  | 'SIN_CONFIGURAR'
  | 'CONFIGURACION_INCOMPLETA'
  | 'CON_INCIDENCIAS'
  | 'CONFIGURADO';

/** One CRM (maestro_clientes) row merged with its Mr Outreach operational configuration, if any. */
export interface AdminClientOverview {
  crmClientId: number;
  name: string;
  rut: string | null;
  rubro: string | null;
  crmStatus: string;
  managedClientId: string | null;
  configurationStatus: ClientConfigurationStatus;
  domainCount: number;
  mailboxCount: number;
  assignedExecutiveCount: number;
}

export interface AdminClientsListResult {
  /** false when the external CRM connection failed — never a hard 500, see PostgresCrmClientRepository. */
  available: boolean;
  clients: AdminClientOverview[];
}
