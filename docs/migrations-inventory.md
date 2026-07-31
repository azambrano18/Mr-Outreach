# Inventario de migraciones — release candidate

Las 4 migraciones activas, en el orden exacto en que Prisma las aplica.
Verificado directamente contra `_prisma_migrations` en `test` y en
`development` — ambos branches muestran las mismas 4 filas, `finished_at`
no nulo, ninguna `rolled_back_at` activa, en el mismo orden.

| Migración | Objetivo | Tablas/columnas principales | Destructiva | Aplicada `test` | Aplicada `development` | Pendiente `production` |
|---|---|---|---|---|---|---|
| `20260730000000_init_mr_outreach` | Esquema inicial completo, consolidado desde 13 migraciones incrementales previas, generado desde un estado vacío — nunca desde ni hacia el proyecto Neon "Mejoreferido" | Las 35 tablas funcionales del catálogo (ver `docs/database-architecture.md` §6) | No | ✅ | ✅ | ✅ Sí |
| `20260730000001_restore_case_insensitive_unique_indexes` | Restaura 2 índices únicos parciales/de expresión que Prisma no puede declarar de forma nativa (`LOWER(email)`, unicidad condicionada a `deletedAt IS NULL`) | `companies` (índice compuesto), `contacts` (índice case-insensitive sobre email) | No | ✅ | ✅ | ✅ Sí |
| `20260731000000_persist_conversations_and_active_flow_attribution` | Persiste Conversaciones/Mensajes/Etiquetas/Notas/Lectura (antes solo en memoria de proceso) y agrega la atribución del flujo activo (Company/Contact en `ProspectImportRow`, `Domain.serverDomainId`, `IntegrationAggregateType` +TEMPLATE/+EXECUTION) | 6 tablas nuevas (`conversations`, `conversation_messages`, `conversation_tags`, `conversation_tag_assignments`, `conversation_notes`, `conversation_read_states`) + columnas en `domains`/`prospect_import_rows` | No | ✅ | ✅ | ✅ Sí |
| `20260731145609_motor_event_ingestion` | Extiende `IntegrationEvent` para la recepción durable de eventos del motor (Fase "Recepción de eventos del motor") | `integration_events`: 6 columnas nuevas (`aggregateId`, `aggregateType`, `attempts`, `errorCode`, `failedAt`, `occurredAt`), 3 valores nuevos de enum (`PROCESSING`, `FAILED_RETRYABLE`, `FAILED_TERMINAL`), 1 índice | No | ✅ | ✅ | ✅ Sí |

## Confirmaciones

- **Orden correcto**: verificado por timestamp de nombre de migración y
  por el orden real en `_prisma_migrations.started_at` en ambos branches
  reales — coinciden.
- **Ausencia de drift**: `test` y `development` muestran exactamente las
  mismas 4 filas `finished_at` no nulo, mismo orden, ninguna diferencia.
- **Ausencia de `DROP`**: `grep -ilE "^\s*DROP " prisma/migrations/*/migration.sql` no encuentra ninguna coincidencia en las 4 migraciones.
- **Ausencia de secretos**: ninguna migración contiene una cadena de
  conexión, contraseña o clave — las únicas coincidencias de las palabras
  "password"/"secret" son nombres de columna (`passwordHash`,
  `imapSecretCiphertext`, `smtpSecretCiphertext`, etc.), nunca un valor.
- **Ausencia de banners**: ningún archivo `migration.sql` contiene texto
  de interfaz de usuario ni salida de terminal pegada por error.
- **Ausencia de datos reales**: las 4 migraciones son DDL puro (`CREATE
  TABLE`/`ALTER TABLE`/`CREATE INDEX`/`CREATE TYPE`/`ALTER TYPE ADD
  VALUE`) — ninguna contiene un `INSERT` con datos.
- **Compatibilidad con una base vacía**: la migración inicial se generó
  explícitamente `--from-empty`, y las 3 migraciones siguientes son
  aditivas sobre ese mismo estado — aplicables en orden a un branch
  `production` vacío sin pasos manuales adicionales.
- **`prisma migrate deploy`**: es el único comando usado para aplicar
  estas 4 migraciones en `test`/`development` — nunca `prisma db push`,
  nunca `prisma migrate reset` contra una base con datos reales.
- **Sin dependencia del proyecto "Mejoreferido"**: ninguna migración ni
  el propio `schema.prisma` referencia ese proyecto Neon ni su base
  `maestro_clientes` — la única mención existente en todo el árbol
  versionado es un comentario histórico dentro de
  `20260730000000_init_mr_outreach/migration.sql` explicando que el
  esquema se generó desde un estado vacío, no desde ahí.

## Hashes SHA-256 (para el runbook)

```
529ec38fee85dd0857a300ef75f9bec7f86c26175dbfed791133aa1f725731f6  prisma/migrations/20260730000000_init_mr_outreach/migration.sql
5eb0a3cc8f61119abc114c3dc84769c3cba8fba3b296e49548372bf66e83bff0  prisma/migrations/20260730000001_restore_case_insensitive_unique_indexes/migration.sql
ad2bd7b9c8d6953967e0dadd5b5a8c911d285ae9e88391eb673b9efe142cb98f  prisma/migrations/20260731000000_persist_conversations_and_active_flow_attribution/migration.sql
4e9e77ee0e8bb991e0e8d968eb01fd204abff86526a6b8645dfe4792c3637701  prisma/migrations/20260731145609_motor_event_ingestion/migration.sql
```

Verificar antes de ejecutar `prisma migrate deploy` en `production`:

```
sha256sum -c - <<'EOF'
529ec38fee85dd0857a300ef75f9bec7f86c26175dbfed791133aa1f725731f6  prisma/migrations/20260730000000_init_mr_outreach/migration.sql
5eb0a3cc8f61119abc114c3dc84769c3cba8fba3b296e49548372bf66e83bff0  prisma/migrations/20260730000001_restore_case_insensitive_unique_indexes/migration.sql
ad2bd7b9c8d6953967e0dadd5b5a8c911d285ae9e88391eb673b9efe142cb98f  prisma/migrations/20260731000000_persist_conversations_and_active_flow_attribution/migration.sql
4e9e77ee0e8bb991e0e8d968eb01fd204abff86526a6b8645dfe4792c3637701  prisma/migrations/20260731145609_motor_event_ingestion/migration.sql
EOF
```

**No se modificó ninguna migración ya aplicada** — este documento es de
solo lectura sobre lo ya existente.
