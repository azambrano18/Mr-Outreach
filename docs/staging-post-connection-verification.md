# Verificación posterior a la conexión Railway `staging` → Neon `staging`

## Estado: completado (2026-07-31)

Los pasos §1-§5 de este documento se ejecutaron y verificaron por completo
contra `staging`: build/Pre-Deploy/Start Command en verde, las 4
migraciones aplicadas (confirmadas en `_prisma_migrations`), conteos en 0
antes del bootstrap, y `/health/ready` con `persistence.status: "connected"`.
A partir de ahí se ejecutó `docs/bootstrap-admin-procedure.md` — ver ese
documento para el resultado final (usuario administrador creado, login y
cambio de contraseña verificados en la Web).

Durante el paso §5.3 (confirmar que la Web se comunica con la API) se
encontró y corrigió un problema real: `API_INTERNAL_URL` en
`mr-outreach-web` resolvía con el puerto vacío
(`http://mr-outreach-api.railway.internal:`), causando `fetch failed` en
cada llamada servidor-a-servidor y, en consecuencia, el login fallaba con
el mismo mensaje genérico que una contraseña incorrecta. Causa raíz y
corrección completas documentadas en
`docs/railway-environment-variables-inventory.md`
("Advertencia confirmada: `${{<api-service>.PORT}}` puede resolver
vacío"). Si se repite este mismo síntoma en `production` al configurar
esa variable, revisar esa sección primero.

Railway `staging` (`mr-outreach-api`) ya tiene `DATABASE_URL`/`DIRECT_URL`
apuntando al branch Neon `staging` (confirmado por el propietario del
proyecto — no vuelvo a pedir ese cambio). Este documento cubre lo que
sigue: confirmar que el despliegue posterior terminó bien, que las
migraciones se aplicaron de verdad, que la API está sana, y qué inspeccionar
en la base antes de crear el administrador. Todo es de solo lectura — nada
aquí escribe en Neon ni en Railway. Yo no tengo acceso a ninguno de los
dos paneles; todo esto lo ejecuta quien sí tiene acceso.

## 1. Verificación del deployment en Railway

1. Abre Railway → proyecto **Mr Outreach**.
2. Selecciona el ambiente **staging**.
3. Selecciona el servicio **mr-outreach-api**.
4. Abre la pestaña/sección **Deployments**.
5. Confirma si guardar las variables generó automáticamente un nuevo
   deployment (Railway normalmente redespliega solo al cambiar variables,
   pero puede estar desactivado — confírmalo, no lo asumas).
6. Anota la hora exacta del deployment posterior al cambio de variables.
7. Confirma que ese deployment usa la rama Git
   `release/mr-outreach-production-readiness` (visible en el detalle del
   deployment).
8. Abre los logs de ese deployment y confirma, en orden:
   - [ ] el **Build Command** terminó sin error (busca el código de salida
     al final del paso de build; Railway suele marcarlo explícitamente
     como éxito o fallo).
   - [ ] el **Pre-Deploy Command** terminó sin error (ver §2 abajo para los
     mensajes exactos a buscar).
   - [ ] el **Start Command** arrancó el proceso — busca la línea que
     imprime este propio proyecto: `API listening on port <PORT> (docs at /docs)`
     (viene de `apps/api/src/main.ts`, es la confirmación de que el
     proceso Node realmente quedó escuchando, no solo que Railway lo
     marcó "running").
9. Confirma en el dashboard que el servicio quedó en estado saludable
   (Railway lo marca como "Active"/verde, no "Crashed" ni reiniciando en
   loop).

Si el Build Command o el Pre-Deploy Command fallaron, **no continúes** a
§2 — hay que resolver eso primero, y probablemente signifique que las
migraciones no se aplicaron.

## 2. Verificación del Pre-Deploy Command (`npm run prisma:deploy`)

Confirmado en el repositorio (`package.json` raíz):

```
"prisma:deploy": "prisma migrate deploy"
```

Nunca `prisma migrate dev`, nunca `prisma migrate reset`, nunca
`prisma db push` — ninguno de los tres aparece en ningún script de este
proyecto que Railway pudiera invocar.

En los logs del Pre-Deploy Command (§1.8), busca exactamente estas líneas
(salida estándar de `prisma migrate deploy`):

- **Conexión exitosa**: una línea tipo
  `Datasource "db": PostgreSQL database "neondb"... at "<host>"` — confirma
  que Prisma sí logró resolver `DATABASE_URL`/`DIRECT_URL` y conectarse.
- **Detección de migraciones**: `X migrations found in prisma/migrations`.
  El número `X` debe coincidir con las migraciones reales del repositorio
  — hoy son **4** (ver `docs/migrations-inventory.md`).
- **Aplicación de cada migración pendiente**: una línea
  `Applying migration '<nombre_de_la_migración>'` por cada una que faltaba
  aplicar. Si es la primera vez que corre contra `staging`, deberías ver
  las 4:
  - `20260730000000_init_mr_outreach`
  - `20260730000001_restore_case_insensitive_unique_indexes`
  - `20260731000000_persist_conversations_and_active_flow_attribution`
  - `20260731145609_motor_event_ingestion`
- **Resultado final exitoso**: `All migrations have been successfully applied.`
  Si en cambio dice `No pending migrations to apply.`, significa que ya
  estaban aplicadas de una corrida anterior — igual de válido, pero
  distinto (anótalo).
- **Ausencia de errores Prisma**: no debe aparecer ningún código de error
  con prefijo `P1xxx` (conexión), `P3xxx` (estado de migración) — por
  ejemplo `P3009` (migración fallida previa) o `P1001` (no se puede
  alcanzar la base de datos). Si aparece cualquier línea que empiece con
  `Error:` seguida de un código `P...`, el Pre-Deploy Command falló —
  aunque el servicio termine "online" igual, porque el fallo del
  Pre-Deploy Command debería impedir el deploy, pero confírmalo con el
  código de salida del paso, no solo con que el servicio esté activo.

**No afirmes que las migraciones están aplicadas solo porque el servicio
esté online** — el servicio puede iniciar (y luego fallar en cada request
que toque la base) incluso si el Pre-Deploy Command fue saltado o falló
silenciosamente en alguna configuración de Railway. La única confirmación
válida es ver las líneas de arriba en los logs, o la inspección directa de
§3.

## 3. Verificación de migraciones en Neon `staging` (solo lectura)

Desde el panel de Neon (SQL Editor de solo lectura, o `psql` en modo
solo-lectura — nunca el editor de datos para escribir):

1. Selecciona el proyecto **Mr Outreach**, branch **`staging`**.
2. Confirma que la base de datos existe (nombre esperado `neondb`, ver
   `docs/database-architecture.md` §3).
3. Confirma que la tabla `_prisma_migrations` existe:
   ```sql
   SELECT to_regclass('public._prisma_migrations');
   ```
   Si devuelve `NULL`, no se aplicó ninguna migración todavía.
4. Lista las migraciones aplicadas:
   ```sql
   SELECT migration_name, finished_at, rolled_back_at
   FROM _prisma_migrations
   ORDER BY started_at;
   ```
5. Confirma:
   - [ ] Aparecen exactamente las 4 migraciones de
     `docs/migrations-inventory.md`, con esos nombres exactos.
   - [ ] Cada una tiene `finished_at` no nulo (aplicada completamente).
   - [ ] Ninguna tiene `rolled_back_at` distinto de nulo.
   - [ ] No hay ninguna fila adicional que no corresponda a las 4
     migraciones del repositorio (si aparece una migración con un nombre
     que no existe en `prisma/migrations/`, detente y avísame).
6. Confirma que las tablas esperadas existen (lista completa en
   `prisma/schema.prisma`, nombres reales vía `@@map`):
   ```sql
   SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;
   ```
   Deberían aparecer, entre otras: `organizations`, `users`, `roles`,
   `permissions`, `user_roles`, `role_permissions`, `audit_logs`,
   `managed_clients`, `domains`, `mailboxes`, `sequence_templates`,
   `sequence_template_versions`, `sequence_executions`, `contacts`,
   `conversations`, `integration_events`, `integration_commands`.

No propongas ni ejecutes escrituras manuales desde el editor de Neon en
ningún punto de esta sección — todo es `SELECT`.

## 4. Inspección de conteos antes del bootstrap (solo lectura)

Mismo SQL Editor de solo lectura. Un `SELECT count(*)` por tabla es
suficiente — no hace falta traer filas completas:

```sql
SELECT
  (SELECT count(*) FROM organizations)      AS organizaciones,
  (SELECT count(*) FROM users)              AS usuarios,
  (SELECT count(*) FROM roles)              AS roles,
  (SELECT count(*) FROM permissions)        AS permisos,
  (SELECT count(*) FROM user_roles)         AS asignaciones_usuario_rol,
  (SELECT count(*) FROM role_permissions)   AS relaciones_rol_permiso,
  (SELECT count(*) FROM audit_logs)         AS auditorias,
  (SELECT count(*) FROM managed_clients)    AS clientes,
  (SELECT count(*) FROM domains)            AS dominios,
  (SELECT count(*) FROM mailboxes)          AS mailboxes,
  (SELECT count(*) FROM sequence_templates) AS plantillas,
  (SELECT count(*) FROM sequence_template_versions) AS versiones_de_plantillas,
  (SELECT count(*) FROM sequence_executions) AS gestiones,
  (SELECT count(*) FROM contacts)           AS contactos;
```

Qué esperar y qué hacer con cada resultado:

- **Todo en 0** (excepto `permissions`, que `bootstrap-admin --apply`
  llena de todos modos): consistente con un branch creado vacío —
  procede con confianza a `bootstrap-admin --check`.
- **`permissions` con filas, todo lo demás en 0**: también aceptable — es
  posible que un `prisma migrate deploy` previo o un seed parcial haya
  corrido antes; no bloquea el bootstrap (`bootstrap-admin` sincroniza el
  catálogo de forma idempotente).
- **`organizations`/`users` con filas**: **detente antes de continuar** —
  investiga qué son esas filas (¿un seed corrió por error contra
  `staging`? ¿son fixtures de otra prueba?) antes de ejecutar el bootstrap.
  Un vistazo rápido y de solo lectura:
  ```sql
  SELECT id, name FROM organizations LIMIT 20;
  SELECT id, email, "organizationId", status FROM users LIMIT 20;
  ```
- **Cualquier otra tabla con filas inesperadas** (clientes, dominios,
  mailboxes, plantillas, gestiones, contactos): mismo criterio — no es
  necesariamente un problema (podría ser una prueba funcional deliberada
  ya realizada), pero debe explicarse antes de continuar, no asumirse.

No uses Prisma Studio para editar nada en esta inspección — solo lectura,
y preferentemente vía el SQL Editor de Neon o un `psql` de solo lectura.

## 5. Verificación de la API

No uses una respuesta 404 de una ruta inexistente como prueba de salud —
usa los health checks reales que ya existen en este proyecto
(`apps/api/src/modules/health/`):

1. **`GET /health/live`** — responde `200` con
   `{"status":"ok","service":"api"}` siempre que el proceso esté vivo (no
   comprueba la base de datos). Confirma solo que el proceso arrancó.
2. **`GET /health/ready`** — la comprobación real. Responde `200` con:
   ```json
   {
     "status": "ok",
     "mode": "integrated",
     "persistence": { "driver": "postgres", "status": "connected" },
     "engine": { "driver": "<...>", "status": "<...>" }
   }
   ```
   Confirma explícitamente:
   - [ ] `persistence.driver` es `"postgres"` (nunca `"memory"` en
     `staging`).
   - [ ] `persistence.status` es `"connected"` — este valor solo aparece
     si `PrismaService.ping()` (un `SELECT 1` real contra la base
     configurada) tuvo éxito; si la conexión fallara, sería `"unavailable"`
     y el endpoint respondería `503` en vez de `200`. Esta es la prueba de
     conectividad real, no una suposición.
   - [ ] `status` global es `"ok"` (si `persistence` o `engine` están
     `"unavailable"`, sería `"error"` con HTTP `503`).
3. Confirma que la Web (`mr-outreach-web-staging...`) sigue cargando y
   comunicándose con la API — abre la pantalla de login y confirma que no
   hay errores de red en la consola del navegador (no hace falta iniciar
   sesión todavía, no hay usuarios).
4. Confirma en las variables de Railway (sin pegarlas en el chat) que
   `mr-outreach-api` en `staging` mantiene `PERSISTENCE_DRIVER=postgres` —
   si en algún punto se cambió a `memory`, `/health/ready` lo reportaría
   igual, así que el paso 2 ya cubre esto indirectamente, pero confírmalo
   también en la variable misma.

Si `/health/ready` responde `persistence.status: "unavailable"` o HTTP
`503`, **no continúes** con el bootstrap — hay un problema de conexión que
resolver primero (revisar que `DATABASE_URL`/`DIRECT_URL` realmente
apunten al branch `staging` y que ese branch esté accesible).

## 6. Qué NO hace este documento

- No ejecuta nada de lo anterior por mí — no tengo acceso a Neon ni a
  Railway.
- No propone ni ejecuta ninguna escritura contra `staging`, `development`,
  `test` ni `production`.
- No es el procedimiento de creación del branch (ver
  `docs/neon-staging-branch-procedure.md`) ni el del bootstrap del
  administrador (ver `docs/bootstrap-admin-procedure.md`) — es
  específicamente la verificación entre ambos.
