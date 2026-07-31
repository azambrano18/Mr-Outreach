# Bloqueadores finales antes de producción

| Prioridad | Bloqueador | Estado | Responsable | Evidencia necesaria | ¿Bloquea production? |
|---|---|---|---|---|---|
| Alta | `OPERATIONAL_STATUS_CHECK` sin implementar | PENDIENTE DEL MOTOR | Equipo del motor + Mr Outreach | Confirmación de `docs/operational-status-check-motor-handoff.md` | **No** — `ClientEligibilityService.assertEligibleForPublish` funciona hoy con el snapshot local; la llamada real es una mejora futura, no un requisito de arranque |
| Alta | Autenticación real del motor (mailbox/sequence-template/sequence-execution `http` mode) | PENDIENTE DEL MOTOR | Equipo del motor | Endpoint real + API key emitida | **Sí, indirectamente** — mientras `MAILBOX_MOTOR_DRIVER`/`SEQUENCE_MOTOR_MODE` sigan en modo simulado, Plantillas/Gestiones no llegan a un motor real; production puede desplegarse igual en modo simulado, pero el flujo activo real no funcionará hasta que esto se resuelva |
| Alta | Variables Railway no configuradas | PENDIENTE DE INFRAESTRUCTURA | Responsable de infraestructura | Las variables de `docs/railway-environment-variables-inventory.md` cargadas en Railway | **Sí** — requisito literal para arrancar el proceso |
| Alta | Migraciones no aplicadas en `production` | PENDIENTE DE INFRAESTRUCTURA | Responsable de infraestructura | Salida de `prisma migrate deploy` + `_prisma_migrations` verificado | **Sí** — sin esquema no hay aplicación |
| Alta | Mecanismo del primer usuario administrador no definido operativamente | PENDIENTE INTERNO | Responsable de release | Decisión documentada de cómo se crea el primer ADMIN (ver runbook §13) | **Sí** — sin un ADMIN nadie puede operar el sistema |
| Media | Dominio/API pública no resuelto todavía | PENDIENTE DE INFRAESTRUCTURA | Responsable de infraestructura | DNS + certificado HTTPS válidos | **Sí** |
| Baja | CORS (`WEB_ORIGIN`) | RESUELTO (código) / PENDIENTE DE INFRAESTRUCTURA (valor) | Responsable de infraestructura | Variable cargada con el dominio real del frontend | **Sí, pero trivial** — el código ya lo exige estricto, solo falta el valor |
| Baja | Cookies de sesión | RESUELTO | — | `secure` ya deriva de `NODE_ENV`, `httpOnly`+`sameSite=lax` ya fijos | No |
| Media | Bucket Cloudflare R2 de producción | PENDIENTE DE INFRAESTRUCTURA | Responsable de infraestructura | Bucket creado, dominio propio HTTPS confirmado (nunca `*.r2.dev`) | **Sí**, para que las firmas con imagen funcionen — el resto de la app no depende de esto |
| Media | Respaldos automatizados de Neon `production` | ACEPTADO COMO DEUDA para el MVP | Responsable de infraestructura | Procedimiento manual de branch-snapshot ya documentado en el runbook (§10); automatizarlo es una mejora futura | No |
| Media | Observabilidad (alertas proactivas) | ACEPTADO COMO DEUDA para el MVP | — | Ver `docs/observability-assessment.md` — `/health/live`/`/health/ready` ya cubren el escenario crítico (caída total) | No |
| Baja | Playwright | **No configurado** | — | No existe configuración de Playwright en este repositorio; la cobertura E2E real es Jest + Supertest (221 pruebas) | No — nunca se declaró como aprobado, solo como inexistente |
| Baja | Sistema legacy (Secuencias/`Sequence`/`ScheduledEmail`) | RESUELTO (decisión ya tomada) | — | Congelado intencionalmente en una fase anterior — Conversaciones puede seguir necesitando esas tablas para atribución histórica; documentado, no eliminado | No |
| Media | Reintento manual de `IntegrationCommand` (Alternativa A: `TEMPLATE`/`EXECUTION`) estancado en `REQUESTED` | ACEPTADO COMO DEUDA | — | Hoy la recuperación es reintentar la misma acción del usuario (publicar/iniciar) con el mismo `idempotencyKey` — ya probado (`idempotent-operation.service.spec.ts`, `publish-sequence.integration.spec.ts`, `link-mailbox.integration.spec.ts`). No existe un botón de admin dedicado como el que sí tiene `IntegrationEvent` (`retry-projection`) | No |
| Baja | Datos sintéticos en `development` | RESUELTO | — | Limpiados en la fase anterior, con respaldo lógico previo — ver informe de esa fase | No |
| Baja | Inventario de pruebas | RESUELTO | — | Reconciliado en `docs/test-inventory-reconciliation.md` | No |

## Resumen de bloqueadores reales (impiden un despliegue hoy mismo)

Solo 6 filas bloquean literalmente un despliegue, y las 6 son trabajo de
**infraestructura/configuración esperado**, no defectos de código:
variables Railway, migración de producción, decisión operativa del primer
admin, dominio/DNS, valor de `WEB_ORIGIN`, bucket R2. Ninguna requiere
cambios de código adicionales sobre el release candidate actual.
