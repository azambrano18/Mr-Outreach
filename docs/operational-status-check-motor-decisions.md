# OPERATIONAL_STATUS_CHECK — decisiones pendientes del responsable del motor

Documento breve, exclusivo para las decisiones que debe responder el
equipo responsable del motor. El contrato completo y el contexto están en
[`docs/operational-status-check-motor-handoff.md`](./operational-status-check-motor-handoff.md)
y en [`docs/operational-status-check-contract-v1.md`](./operational-status-check-contract-v1.md).

**Estado: bloqueador de producción** (ver `docs/production-blockers.md`).
No se implementa código contra este contrato hasta que esta tabla quede
completa.

| Nº | Decisión | Recomendación de Mr Outreach | Respuesta del motor | Observaciones |
|---:|---|---|---|---|
| 1 | Transporte | HTTP síncrono | Pendiente | |
| 2 | Autenticación | Reutilizar el mecanismo seguro de los adaptadores actuales | Pendiente | |
| 3 | Endpoint o commandType | Pendiente de confirmación | Pendiente | |
| 4 | Timeout | 5 segundos | Pendiente | |
| 5 | Reintentos | 1 reintento en timeout o 5xx | Pendiente | |
| 6 | Idempotencia | Obligatoria mediante idempotencyKey | Pendiente | |
| 7 | Unicidad de serverClientId | Global, según evidencia actual | Pendiente | |
| 8 | Unicidad de serverDomainId | Pendiente; usar aislamiento por organizationId mientras no se confirme | Pendiente | |
| 9 | Unicidad de serverMailboxId | Pendiente de confirmación explícita | Pendiente | |
| 10 | Unicidad de serverTemplateId | Pendiente | Pendiente | |
| 11 | Unicidad de serverExecutionId | Pendiente | Pendiente | |
| 12 | Unicidad de serverMessageId | Pendiente | Pendiente | |
| 13 | Estados operacionales | ACTIVE, INACTIVE, SUSPENDED, REVOKED, UNLINKED, NOT_FOUND, UNKNOWN | Pendiente | |
| 14 | blockReasonCode | Catálogo por definir | Pendiente | |
| 15 | Identificador inexistente | Fail-closed y NOT_FOUND | Pendiente | |
| 16 | Respuesta inconsistente | Fail-closed | Pendiente | |
| 17 | Firma o credencial inválida | Rechazar y bloquear operación | Pendiente | |
| 18 | Ventana de idempotencia | Pendiente | Pendiente | |

## Contrato propuesto (referencia rápida — no modificar sin justificación)

**Request** — campos exactos, sin renombrar ni agregar sin justificación:

`schemaVersion`, `commandType`, `commandId`, `correlationId`,
`idempotencyKey`, `requestedAt`, `organizationId`, `serverClientId`,
`serverDomainId`, `serverMailboxId`, `operation`.

**Response** — campos exactos, sin renombrar ni agregar sin justificación:

`schemaVersion`, `commandId`, `correlationId`, `checkedAt`,
`serverClientId`, `serverDomainId`, `serverMailboxId`, `clientStatus`,
`domainStatus`, `mailboxStatus`, `eligible`, `blockReasonCode`,
`blockReason`, `motorStatusCode`.

## Reglas fail-closed no negociables

Mr Outreach bloqueará la publicación de una Plantilla o el inicio de una
Gestión cuando ocurra cualquiera de estas condiciones:

- el motor no responde;
- se supera el timeout;
- falla la autenticación;
- existe una versión (`schemaVersion`) incompatible;
- algún identificador de la respuesta no coincide con el de la request;
- cualquiera de `clientStatus`/`domainStatus`/`mailboxStatus` es distinto
  de `ACTIVE`;
- `eligible` es distinto de `true`;
- la respuesta está incompleta (falta un campo requerido);
- la respuesta es estructuralmente inconsistente.

Ninguna de estas reglas es negociable ni depende de la respuesta del
motor — son parte del diseño de Mr Outreach independientemente de qué
conteste el motor.

## Puntos de invocación (documentados, no implementados todavía)

La validación debe ejecutarse, como mínimo:

1. inmediatamente antes de publicar una Plantilla o su actualización;
2. inmediatamente antes de iniciar una Gestión;
3. eventualmente antes de reintentar una Gestión bloqueada, si el estado
   previamente confirmado ya expiró.

**Ninguna de estas tres llamadas está implementada todavía** — se
documentan aquí como el alcance mínimo acordado, pendientes de
implementación hasta que esta tabla de decisiones quede completa.
