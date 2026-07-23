import type { MailboxSummary } from '@outreach/shared-types';

export type MailboxLinkStatus =
  | 'SIN_CONFIGURAR'
  | 'CONFIGURADA_LOCALMENTE'
  | 'VINCULACION_SOLICITADA'
  | 'ACEPTADA_POR_EL_SERVIDOR'
  | 'EN_PROCESO'
  | 'VINCULADA'
  | 'ERROR_DE_VINCULACION'
  | 'DESACTIVADA';

const LABEL: Record<MailboxLinkStatus, string> = {
  SIN_CONFIGURAR: 'Sin configurar',
  CONFIGURADA_LOCALMENTE: 'Configurada localmente',
  VINCULACION_SOLICITADA: 'Vinculación solicitada',
  ACEPTADA_POR_EL_SERVIDOR: 'Aceptada por el servidor',
  EN_PROCESO: 'En proceso',
  VINCULADA: 'Vinculada',
  ERROR_DE_VINCULACION: 'Error de vinculación',
  DESACTIVADA: 'Desactivada',
};

export type MailboxLinkStatusTone = 'neutral' | 'warning' | 'good' | 'error';

const TONE: Record<MailboxLinkStatus, MailboxLinkStatusTone> = {
  SIN_CONFIGURAR: 'neutral',
  CONFIGURADA_LOCALMENTE: 'neutral',
  VINCULACION_SOLICITADA: 'warning',
  ACEPTADA_POR_EL_SERVIDOR: 'warning',
  EN_PROCESO: 'warning',
  VINCULADA: 'good',
  ERROR_DE_VINCULACION: 'error',
  DESACTIVADA: 'neutral',
};

/** Spec §3.2 — the 8 link-status values, derived from fields that already exist on Mailbox; never a field of its own. */
export function deriveMailboxLinkStatus(mailbox: MailboxSummary): MailboxLinkStatus {
  if (mailbox.status === 'INACTIVE' || mailbox.status === 'ARCHIVED') return 'DESACTIVADA';
  if (mailbox.provisioningStatus === 'PROVISION_FAILED') return 'ERROR_DE_VINCULACION';
  if (mailbox.provisioningStatus === 'PROVISIONED' && mailbox.connectionStatus === 'CONNECTED') return 'VINCULADA';
  if (mailbox.provisioningStatus === 'PROVISIONING') return 'EN_PROCESO';
  if (mailbox.provisioningStatus === 'PROVISION_REQUESTED') return 'VINCULACION_SOLICITADA';
  return 'CONFIGURADA_LOCALMENTE';
}

export function mailboxLinkStatusLabel(status: MailboxLinkStatus): string {
  return LABEL[status];
}

export function mailboxLinkStatusTone(status: MailboxLinkStatus): MailboxLinkStatusTone {
  return TONE[status];
}
