# Evaluación de observabilidad — antes de producción

Evaluación del estado real del código, sin implementar una plataforma de
observabilidad nueva. Clasificación: **disponible** / **parcial** /
**inexistente** / **bloqueador** / **recomendable después del MVP**.

| Capacidad | Estado | Evidencia | Clasificación |
|---|---|---|---|
| Health endpoint | Disponible | `GET /health/live` — siempre 200 si el proceso está vivo, nunca consulta dependencias externas | **Disponible** |
| Readiness endpoint | Disponible | `GET /health/ready` — verifica Postgres (`PersistenceHealthIndicator`) y el motor de correo (`EngineClient.checkHealth()`), responde 503 si alguno falla | **Disponible** |
| Logs estructurados | Parcial | `Logger` de NestJS usado en 10 archivos; varios casos de uso emiten `console.error(JSON.stringify({event, ...}))` ad hoc (p. ej. `unlink-mailbox.use-case.ts`) — no hay un formateador único ni un nivel configurable centralizado | **Parcial** |
| `requestId` por petición HTTP | Inexistente | Ninguna búsqueda encontró middleware que genere o propague un id de petición | **Recomendable después del MVP** |
| `correlationId` | Parcial | Existe y se propaga correctamente **dentro** del dominio de integración (`IntegrationCommand`/`IntegrationEvent`/`EventEnvelope`/`MotorEventEnvelopeDto`) — no existe a nivel de petición HTTP genérica fuera de ese dominio | **Parcial** |
| Métricas (Prometheus/StatsD/etc.) | Inexistente | Ninguna dependencia ni endpoint `/metrics` en el proyecto | **Recomendable después del MVP** |
| Alertas automáticas | Inexistente | No hay integración con ningún sistema de alertas | **Recomendable después del MVP** — el `blockeador` real es la ausencia de alguna señal mínima, no la ausencia de una plataforma completa |
| Error tracking (Sentry/similar) | Inexistente | Sin dependencia ni configuración de ningún proveedor | **Recomendable después del MVP** |
| Monitoreo de `IntegrationEvent` `FAILED_RETRYABLE` | Parcial | `GET /integration/events` ya lista y filtra por estado (consumido por la UI de "Monitor de integración") — es **consultable manualmente por un admin**, pero nada avisa proactivamente si se acumulan | **Parcial** |
| Monitoreo de `IntegrationCommand` `REQUESTED` estancado | Parcial | `GET /integration/commands` permite la misma consulta manual — mismo gap: sin alerta proactiva | **Parcial** |
| Monitoreo de base de datos (Neon) | Parcial | `/health/ready` detecta caída total de conexión; Neon tiene su propio panel de métricas nativo (uso, conexiones) fuera de este repositorio | **Parcial** |
| Monitoreo de R2 | Inexistente | Ningún health-check ni métrica sobre el adaptador R2 — un fallo de subida de firma solo se ve como un error puntual en el flujo que lo dispara | **Recomendable después del MVP** (bajo volumen esperado de escritura) |
| Monitoreo del motor (mailbox/sequence-template/sequence-execution) | Inexistente como señal proactiva | Los adaptadores HTTP fallan con excepciones capturadas por cada caso de uso (visibles en logs si algo los revisa), pero no hay un dashboard ni alerta dedicada | **Parcial** — mismo mecanismo que el resto, sin agregación |
| Crecimiento de `audit_logs` | Inexistente | Sin monitoreo de tamaño de tabla; sin política de retención automatizada (ver `docs/database-architecture.md` §17, ya documentada como pendiente) | **Recomendable después del MVP** |
| Crecimiento de `conversation_messages` | Inexistente | Mismo caso — sin monitoreo de tamaño ni retención automatizada | **Recomendable después del MVP** |

## Mínimo que production debe poder detectar — evaluación puntual

| Necesidad mínima | ¿Se puede detectar hoy? |
|---|---|
| API caída | Sí — `/health/live` |
| Conexión Neon fallida | Sí — `/health/ready` |
| Migración fallida | Sí, manualmente — consultando `_prisma_migrations` (ver runbook §11); no hay alerta automática |
| Eventos HMAC rechazados | Parcial — quedan como respuestas 401 del endpoint, no hay contador agregado ni alerta; el propio motor externo vería el 401 en su lado |
| Eventos `FAILED_RETRYABLE` | Parcial — consultable vía `GET /integration/events`, sin alerta proactiva |
| Comandos `REQUESTED` estancados | Parcial — consultable vía `GET /integration/commands`, sin alerta proactiva |
| Motor no disponible | Parcial — cada adaptador HTTP lanza una excepción capturada por su caso de uso; visible si alguien revisa logs, no hay alerta |
| Errores R2 | Inexistente como señal agregada |
| Crecimiento de `audit_logs` | Inexistente |
| Crecimiento de `conversation_messages` | Inexistente |

## Conclusión

**Ningún ítem de esta lista es, por sí solo, un bloqueador absoluto para
un primer despliegue a producción de bajo volumen** (MVP): `/health/live`
y `/health/ready` ya cubren la detección de caída total (API o Neon), que
es el escenario más crítico. Los gaps reales son la ausencia de
**alertas proactivas** para los estados intermedios (`FAILED_RETRYABLE`,
`REQUESTED` estancado) — hoy dependen de que un humano entre a revisar el
Monitor de integración manualmente.

**No se implementó ninguna corrección en esta fase** porque no se
demostró un defecto real (Fase 12 de este pedido no autoriza
funcionalidad nueva) — se deja como recomendación explícita para
inmediatamente después del MVP, listada en `docs/production-blockers.md`.
