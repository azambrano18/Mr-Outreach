# Bloqueadores finales antes de producción

**Corrección aplicada**: `OPERATIONAL_STATUS_CHECK` se reclasifica de
"deuda aceptable para el MVP" a **BLOQUEADOR DE PRODUCTION**, por
instrucción expresa. La arquitectura funcional acordada exige que, antes
de publicar una Plantilla o iniciar una Gestión, Mr Outreach consulte al
motor, confirme el estado vigente de cliente/dominio/mailbox, actualice
el snapshot local, y bloquee la operación si el motor no confirma
elegibilidad. Mientras ese contrato no esté confirmado e implementado,
existe riesgo real de iniciar una Gestión contra una cuenta suspendida,
revocada, desvinculada o inactiva — operar solo con el snapshot local no
cumple esa arquitectura y **no se acepta como suficiente salvo aprobación
expresa y formal de ese riesgo**, que todavía no se ha dado.

| Prioridad | Bloqueador | Estado | Responsable | Evidencia requerida | Riesgo | ¿Bloquea production? |
|---|---|---|---|---|---|---|
| **Crítica** | `OPERATIONAL_STATUS_CHECK` | **PENDIENTE DEL MOTOR** | Responsable del motor + Mr Outreach | Contrato aprobado (`docs/operational-status-check-motor-decisions.md` completado) e implementación validada | Operar con estado local obsoleto — iniciar una Gestión o publicar una Plantilla contra un cliente/dominio/mailbox ya suspendido, revocado o desvinculado sin que el motor lo haya confirmado | **Sí** |
| Alta | Autenticación real del motor (mailbox/sequence-template/sequence-execution `http` mode) | PENDIENTE DEL MOTOR | Equipo del motor | Endpoint real + API key emitida | Sin esto, Plantillas/Gestiones nunca llegan a un motor real — quedan en modo simulado indefinidamente | Sí, indirectamente — el flujo activo real no funciona hasta resolverse, aunque el proceso arranque igual |
| Alta | Variables Railway no configuradas | PENDIENTE DE INFRAESTRUCTURA | Responsable de infraestructura | Variables de `docs/railway-environment-variables-inventory.md` cargadas en Railway | El proceso no arranca sin ellas | Sí |
| Alta | Migraciones no aplicadas en `production` | PENDIENTE DE INFRAESTRUCTURA | Responsable de infraestructura | Salida de `prisma migrate deploy` + `_prisma_migrations` verificado | Sin esquema no hay aplicación | Sí |
| Alta | Mecanismo del primer usuario administrador no definido operativamente | PENDIENTE INTERNO | Responsable de release | Decisión documentada de cómo se crea el primer ADMIN (runbook §13) | Sin un ADMIN nadie puede operar el sistema | Sí |
| Media | Dominio/API pública no resuelto todavía | PENDIENTE DE INFRAESTRUCTURA | Responsable de infraestructura | DNS + certificado HTTPS válidos | Sin dominio resuelto no hay acceso público | Sí |
| Baja | CORS (`WEB_ORIGIN`) | RESUELTO (código) / PENDIENTE DE INFRAESTRUCTURA (valor) | Responsable de infraestructura | Variable cargada con el dominio real del frontend | Bajo — el código ya lo exige estricto, solo falta el valor | Sí, pero trivial |
| Baja | Cookies de sesión | RESUELTO | — | `secure` ya deriva de `NODE_ENV`, `httpOnly`+`sameSite=lax` ya fijos | Ninguno | No |
| Media | Bucket Cloudflare R2 de producción | PENDIENTE DE INFRAESTRUCTURA | Responsable de infraestructura | Bucket creado, dominio propio HTTPS confirmado (nunca `*.r2.dev`) | Sin esto, las firmas con imagen no funcionan — el resto de la app no depende de esto | Sí, acotado a firmas |
| Media | Respaldos automatizados de Neon `production` | ACEPTADO COMO DEUDA para el MVP | Responsable de infraestructura | Procedimiento manual de branch-snapshot ya documentado en el runbook (§10) | Bajo si el procedimiento manual se sigue disciplinadamente en cada despliegue | No |
| Media | Observabilidad (alertas proactivas) | ACEPTADO COMO DEUDA para el MVP | — | Ver `docs/observability-assessment.md` | Detección tardía de estados intermedios (`FAILED_RETRYABLE`, comandos estancados) — la caída total sí se detecta hoy | No |
| Baja | Playwright | **No configurado** | — | No existe configuración de Playwright en este repositorio; la cobertura E2E real es Jest + Supertest (221 pruebas) | Ninguno — nunca se declaró como aprobado | No |
| Baja | Sistema legacy (Secuencias/`Sequence`/`ScheduledEmail`) | RESUELTO (decisión ya tomada) | — | Congelado intencionalmente — Conversaciones puede seguir necesitando esas tablas para atribución histórica | Ninguno — documentado, no eliminado | No |
| Media | Reintento manual de `IntegrationCommand` (Alternativa A: `TEMPLATE`/`EXECUTION`) estancado en `REQUESTED` | ACEPTADO COMO DEUDA | — | Hoy la recuperación es reintentar la misma acción del usuario con el mismo `idempotencyKey` — ya probado | Bajo — cubierto funcionalmente, solo falta un botón de admin dedicado | No |
| Baja | Datos sintéticos en `development` | RESUELTO | — | Limpiados en la fase anterior, con respaldo lógico previo | Ninguno | No |
| Baja | Inventario de pruebas | RESUELTO | — | Reconciliado en `docs/test-inventory-reconciliation.md` | Ninguno | No |

## Resumen de bloqueadores reales (impiden un despliegue hoy mismo)

**7 filas bloquean literalmente un despliegue**, no 6: las 6 de
infraestructura/decisión interna ya identificadas (variables Railway,
migración de producción, decisión del primer admin, dominio/DNS, valor de
`WEB_ORIGIN`, bucket R2) **más `OPERATIONAL_STATUS_CHECK`**, ahora
clasificado como bloqueador de production por instrucción expresa —
no como deuda aceptable para el MVP. Esta reclasificación solo se
levanta si (a) el contrato queda confirmado e implementado, o (b) el
responsable del producto aprueba expresa y formalmente operar únicamente
con el snapshot local, aceptando por escrito el riesgo descrito arriba.
Ninguna de las 7 filas requiere cambios de código adicionales sobre el
release candidate actual, salvo la eventual implementación de
`OPERATIONAL_STATUS_CHECK` una vez el motor confirme el contrato.
