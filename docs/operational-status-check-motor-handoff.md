# OPERATIONAL_STATUS_CHECK — documento de entrega para el responsable del motor

**Versión propuesta 1.0 — pendiente de aprobación conjunta. No implementado.**

Este documento es la versión ejecutiva y técnica lista para enviar al
equipo responsable del servidor motor. La especificación completa,
detallada sección por sección, vive en
[`docs/operational-status-check-contract-v1.md`](./operational-status-check-contract-v1.md)
— este documento resume lo mismo y agrega la lista concreta de decisiones
que necesitamos que confirmen antes de que Mr Outreach implemente
cualquier código contra este contrato.

## Resumen ejecutivo

Antes de publicar una Plantilla o iniciar una Gestión, Mr Outreach quiere
poder preguntarle al motor si el cliente, el dominio y la cuenta de correo
involucrados siguen operativos de verdad (no solo según el último dato que
Mr Outreach guardó localmente). Hoy esa consulta **no existe** — Mr
Outreach decide con su propio snapshot local únicamente. Este documento
propone el contrato para agregar esa consulta en el futuro, sin
comprometerse todavía a una implementación concreta.

## Decisiones que el responsable del motor debe confirmar

Estas 10 decisiones son las únicas que bloquean el inicio de la
implementación. Mr Outreach no puede tomarlas por su cuenta porque
dependen de cómo está construido el motor.

1. **Transporte**: ¿HTTP síncrono, comando versionado (mismo mecanismo que
   `IntegrationCommand`), u otra alternativa que el motor ya soporte?
2. **Autenticación**: ¿el mismo mecanismo que ya usan las llamadas
   salientes actuales de Mr Outreach hacia el motor, un token de servicio
   nuevo, o el esquema HMAC que Mr Outreach ya construyó para recibir
   eventos entrantes?
3. **Endpoint o `commandType` definitivo** (nombre y ruta exactos).
4. **Timeout** aceptable para esta consulta.
5. **Política de reintentos** que el motor tolera sin efectos secundarios.
6. **Garantía de idempotencia**: ¿repetir la misma consulta con el mismo
   `idempotencyKey` es siempre seguro del lado del motor?
7. **Unicidad global o por organización** de cada identificador:
   `serverClientId`, `serverDomainId`, `serverMailboxId`,
   `serverTemplateId`, `serverExecutionId`, `serverMessageId`.
8. **Estados definitivos** que el motor puede reportar para cliente/
   dominio/mailbox: `ACTIVE`, `INACTIVE`, `SUSPENDED`, `REVOKED`,
   `UNLINKED`, `NOT_FOUND`, `UNKNOWN` — ¿esta lista es completa y
   correcta, o falta/sobra alguno?
9. **Códigos `blockReasonCode`** — el catálogo cerrado de razones que el
   motor puede devolver cuando bloquea una operación.
10. **Comportamiento ante un identificador que el motor no reconoce** —
    ¿siempre `NOT_FOUND` con 200, o un error HTTP distinto?

## Ejemplo de request

```json
{
  "schemaVersion": "1.0",
  "commandType": "OPERATIONAL_STATUS_CHECK",
  "commandId": "cmd_uuid",
  "correlationId": "corr_uuid",
  "idempotencyKey": "idem_uuid",
  "requestedAt": "2026-07-31T15:00:00.000Z",
  "organizationId": "org_...",
  "serverClientId": "client_...",
  "serverDomainId": "domain_...",
  "serverMailboxId": "mailbox_...",
  "operation": "TEMPLATE_PUBLISH | EXECUTION_START"
}
```

## Ejemplo de response

```json
{
  "schemaVersion": "1.0",
  "commandId": "cmd_uuid",
  "correlationId": "corr_uuid",
  "checkedAt": "2026-07-31T15:00:01.200Z",
  "serverClientId": "client_...",
  "serverDomainId": "domain_...",
  "serverMailboxId": "mailbox_...",
  "clientStatus": "ACTIVE",
  "domainStatus": "ACTIVE",
  "mailboxStatus": "ACTIVE",
  "eligible": true,
  "blockReasonCode": null,
  "blockReason": null,
  "motorStatusCode": "OPERATIONAL"
}
```

## Tabla de decisiones

| Decisión | Recomendación Mr Outreach | Confirmación del motor | Observaciones |
|---|---|---|---|
| Transporte | HTTP síncrono, mismo patrón que los adaptadores salientes ya existentes (`HttpMailboxMotorAdapter`, etc.) | | |
| Autenticación | Mismo mecanismo que las llamadas salientes actuales de Mr Outreach hacia el motor | | |
| Endpoint / commandType | `POST /v1/operational-status/check` (propuesto, no confirmado) | | |
| Timeout | 5 segundos, igual al resto de los adaptadores HTTP existentes | | |
| Reintentos | 1, solo ante timeout o 5xx | | |
| Idempotencia | `idempotencyKey` identifica la consulta; se asume que repetirla es siempre seguro por ser de solo lectura | | |
| Unicidad de `serverClientId` | Global (ya confirmada explícitamente en una fase anterior) | | Sin cambio pendiente |
| Unicidad de `serverDomainId` | Sin evidencia — hoy tratado como único por organización, no global | | |
| Unicidad de `serverMailboxId` | Sin evidencia — hoy enforced y testeado como único, sin declaración formal del motor | | |
| Unicidad de `serverTemplateId` | Sin evidencia — provisional | | |
| Unicidad de `serverExecutionId` | Sin evidencia — provisional | | |
| Unicidad de `serverMessageId` | Sin evidencia — tratado como único por organización, no global | | |
| Estados definitivos | `ACTIVE / INACTIVE / SUSPENDED / REVOKED / UNLINKED / NOT_FOUND / UNKNOWN` | | ¿Lista completa? |
| Códigos `blockReasonCode` | Catálogo abierto, a definir en conjunto | | |
| Identificador no reconocido | `NOT_FOUND` en el campo específico, sin fallar toda la consulta si la operación no lo requiere | | A confirmar caso por caso |

*(Columna "Confirmación del motor" deliberadamente vacía — la completa el
equipo responsable del motor, no Mr Outreach.)*

## Qué NO incluye este documento

- Ninguna URL real ni credencial.
- Ninguna fecha de implementación comprometida.
- Ninguna decisión que le corresponda al motor tomada unilateralmente por
  Mr Outreach.

## Próximo paso

Una vez completada la columna "Confirmación del motor", Mr Outreach
actualizará `docs/operational-status-check-contract-v1.md` con las
decisiones finales y recién entonces comenzará la implementación real —
nunca antes.
