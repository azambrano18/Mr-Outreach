# Procedimiento: crear el primer administrador real en Neon staging

## Estado: completado en `staging` (2026-07-31)

Resultado final, verificado paso a paso (no solo "se ejecutó sin error"):

- **Organización**: `MejoReferido` (`id f67bfe7c-b6b2-4452-8ab2-51ce733a8463`).
- **Usuario administrador**: `sistema@mejoreferido.cl`
  (`id 2ce59446-4d94-4755-a2eb-90050a3a12de`), rol `ADMIN`
  (`id ec1e4581-c272-4df6-84f4-608d19139fc6`) con los 111 permisos del
  catálogo.
- **Login con la contraseña temporal**: confirmado exitoso desde
  `https://mr-outreach-web-staging.up.railway.app` (tras corregir un bug
  de conectividad Web→API no relacionado con el bootstrap en sí — ver
  `docs/staging-post-connection-verification.md`, sección "Estado").
- **Cambio de contraseña obligatorio**: confirmado — la pantalla
  `/dashboard/change-password` forzó el cambio, la contraseña temporal
  dejó de funcionar de inmediato, y la nueva contraseña definida por el
  propio usuario permite iniciar sesión normalmente.
- **Auditoría**: confirmada por consulta SQL directa (la pantalla de
  Auditoría en la UI todavía no existe — es un placeholder conocido,
  `apps/web/app/dashboard/audit/page.tsx`). La fila en `audit_logs` tiene
  `action = 'admin.bootstrap'`, `entityType = 'User'`,
  `entityId = '2ce59446-4d94-4755-a2eb-90050a3a12de'` (coincide con el
  usuario creado), `actorId` vacío (esperado — no hay un actor
  autenticado durante el bootstrap inicial), y `metadata` sin ninguna
  contraseña ni hash: `{"mode": "create", "target": "staging", "projectedResult": "CREATE"}`.

Este documento se conserva completo abajo como referencia del
procedimiento en sí, útil para repetirlo en `production` cuando
corresponda.

---

Este documento es para quien tenga acceso a la consola de Railway (yo no lo
tengo desde este entorno — ver confirmación en la conversación). Cubre el
uso de `prisma/bootstrap-admin.ts` contra el ambiente `staging` del proyecto
Railway "Mr Outreach", servicio `mr-outreach-api`.

**No usar `prisma/seed.ts` para esto** — no es idempotente (crea filas
nuevas en cada ejecución) y está pensado solo para desarrollo local.

## 0. Antes de empezar

- No ejecutar nunca `prisma migrate reset` ni `prisma db push`.
- No cambiar `PERSISTENCE_DRIVER` a `memory`.
- No usar `DEV_ADMIN_EMAIL`/`DEV_ADMIN_PASSWORD`.
- Todo apunta al ambiente `staging` y al servicio `mr-outreach-api`.
- El script nunca imprime un hash de contraseña. Solo imprime una
  contraseña temporal en texto plano una única vez, y solo si crea un
  usuario nuevo — guárdala de inmediato en un gestor de contraseñas, no en
  un chat ni en un archivo sin cifrar.

## 1. Subir los cambios

Estos cambios (`prisma/bootstrap-admin.ts`, el script `prisma:bootstrap-admin`
en `package.json`) están listos localmente en la rama
`release/mr-outreach-production-readiness` pero **todavía no están
commiteados ni pusheados** — quedan a la espera de tu revisión antes de
subirlos, como en cada fase anterior de este proyecto.

## 2. Desplegar la rama

En Railway, tanto `mr-outreach-web` como `mr-outreach-api` ya están
conectados a `release/mr-outreach-production-readiness`. Una vez el commit
esté pusheado, Railway debería redesplegar automáticamente (o dispara un
redeploy manual desde el dashboard del servicio `mr-outreach-api` si el
auto-deploy está desactivado). Confirma que el deployment termina en verde
antes de continuar.

## 3. Abrir la consola de `mr-outreach-api`

En el dashboard de Railway: proyecto **Mr Outreach** → ambiente
**staging** → servicio **mr-outreach-api** → pestaña de shell/consola
("Command" o el ícono de terminal del deployment activo).

## 3.1 Verificar el estado de `staging` antes de `--check`

**No ejecutes `--check` todavía si no completaste esto.** Railway `staging`
ya está conectado a Neon `staging` (confirmado), pero el deployment
posterior, las migraciones, y el estado de la base siguen sin verificar.
Sigue el procedimiento completo de
`docs/staging-post-connection-verification.md` (deployment, Pre-Deploy
Command, migraciones aplicadas, `/health/ready`, conteos de tablas) antes
de continuar aquí.

## 4. Ejecutar `--check` (solo lectura, seguro de correr en cualquier momento)

```bash
BOOTSTRAP_TARGET=staging \
BOOTSTRAP_DATABASE_BRANCH=staging \
BOOTSTRAP_ORGANIZATION_NAME=MejoReferido \
BOOTSTRAP_ADMIN_EMAIL=sistema@mejoreferido.cl \
BOOTSTRAP_ADMIN_FIRST_NAME=<nombre> \
BOOTSTRAP_ADMIN_LAST_NAME=<apellido o descriptor> \
npm run prisma:bootstrap-admin -- --check
```

(Confirmado: `sistema@mejoreferido.com` en mensajes previos fue un error de
tipeo — el dominio real es `.cl`, igual que exige
`REQUIRED_EMAIL_DOMAIN` en `prisma/bootstrap-admin.ts`. No se modificó el
código.)

Reemplaza el correo/nombre/apellido por los reales del primer administrador.
`BOOTSTRAP_DATABASE_BRANCH` es
una segunda confirmación redundante, declarada por quien ejecuta el comando
— no verifica técnicamente a qué branch de Neon apunta `DATABASE_URL` (eso
no es posible desde una simple cadena de conexión Postgres), solo exige que
quien ejecuta el comando declare explícitamente el mismo branch dos veces;
si no coincide con `BOOTSTRAP_TARGET`, el script se niega a continuar. Ver
`docs/database-architecture.md` §2 para la correspondencia completa
Railway ↔ Neon.

## 5. Interpretar el resultado

Al final de la salida verás una línea `Projected result: ...`:

- **`CREATE`** — no existe organización ni usuario con ese correo; el
  siguiente `--apply` creará ambos (o reutilizará la organización si ya
  existe, según el detalle impreso arriba).
- **`RECONCILE`** — la organización y/o el usuario ya existen, pero falta
  el rol `ADMIN`, algún permiso del catálogo, o la asignación del rol al
  usuario. El siguiente `--apply` completa lo que falte, sin tocar la
  contraseña del usuario existente.
- **`NO_CHANGES`** — todo ya está en su lugar; `--apply` no cambiaría nada.
- **`BLOQUEADO` (`BLOCKED`)** — el script se niega a continuar (correo ya
  usado en otra organización, usuario eliminado lógicamente, usuario
  inactivo, u organizaciones ambiguas con el mismo nombre). Lee la razón
  impresa y resuélvela manualmente antes de intentar `--apply` — el script
  no fuerza ninguno de estos casos automáticamente.

Si el resultado no es el esperado, no ejecutes `--apply` todavía —
compártemelo y lo revisamos antes de continuar.

## 5.1 Verificación manual obligatoria antes de `--apply`

`BOOTSTRAP_DATABASE_BRANCH=staging` (igual que `BOOTSTRAP_TARGET=staging`)
es una **confirmación humana**, no una verificación técnica — el script no
tiene forma de comprobar a qué branch de Neon apunta realmente
`DATABASE_URL` (una cadena de conexión Postgres no expone el nombre del
branch de Neon). Antes de ejecutar `--apply`, quien esté en la consola de
`mr-outreach-api` debe confirmar manualmente, mirando Railway y Neon lado
a lado:

1. Ambiente Railway activo: **staging** (no production).
2. Servicio: **mr-outreach-api**.
3. El endpoint pooled (`DATABASE_URL`) pertenece al branch Neon **staging**.
4. El endpoint directo (`DIRECT_URL`) pertenece al branch Neon **staging**.
5. Ambas conexiones están asociadas al mismo branch (no una a `staging` y
   otra a otro branch por error).
6. Ninguna de las dos variables apunta a `production`.
7. Ninguna de las dos variables apunta a `development`.
8. Ninguna de las dos variables apunta a `test`.

No pegues las connection strings ni sus credenciales en ningún lado para
hacer esta verificación — compáralas visualmente en los paneles de Neon y
Railway. Si algo no coincide, no ejecutes `--apply` — corrige las
variables (ver `docs/neon-staging-branch-procedure.md`, Paso 3) primero.

## 6. Ejecutar `--apply` (solo con mi aprobación previa y tras la verificación de 5.1)

Mismos valores que en el paso 4, agregando la confirmación exacta:

```bash
BOOTSTRAP_TARGET=staging \
BOOTSTRAP_DATABASE_BRANCH=staging \
BOOTSTRAP_CONFIRM=CREATE_INITIAL_ADMIN_IN_STAGING \
BOOTSTRAP_ORGANIZATION_NAME=MejoReferido \
BOOTSTRAP_ADMIN_EMAIL=sistema@mejoreferido.cl \
BOOTSTRAP_ADMIN_FIRST_NAME=<nombre> \
BOOTSTRAP_ADMIN_LAST_NAME=<apellido o descriptor> \
npm run prisma:bootstrap-admin -- --apply
```

**No ejecutar todavía** — pendiente de completar
`docs/staging-post-connection-verification.md`, el resultado de `--check`,
y tu aprobación explícita.

El script corre dentro de una única transacción con un bloqueo (advisory
lock) que impide que dos ejecuciones simultáneas se pisen — si otra
ejecución está en curso, esta simplemente aborta con un mensaje claro, sin
tocar nada.

## 7. Guardar la contraseña temporal

Si el resultado fue `CREATE`, la consola imprimirá, **una sola vez, después
de confirmar que la transacción ya se guardó**, algo como:

```
A new user was created. Temporary password (shown once — store it securely now):
<contraseña>

The user must change this password on first login (mustChangePassword=true).
```

Cópiala de inmediato a un gestor de contraseñas. No quedará guardada en
ningún log del script ni en la base de datos en texto plano (se almacena
como hash bcrypt).

Si el resultado fue `RECONCILE` sobre un usuario ya existente, no se genera
ni se cambia ninguna contraseña — el mensaje lo indica explícitamente.

## 8. Probar el login

Desde `https://mr-outreach-web-staging.up.railway.app` (o el dominio real
de la Web en staging), inicia sesión con el correo y la contraseña
temporal.

## 9. Cambiar la contraseña

Al tener `mustChangePassword=true`, el flujo normal de la aplicación debe
forzar el cambio de contraseña en el primer login (pantalla de "cambiar
contraseña obligatorio"). Sigue ese flujo — la nueva contraseña debe tener
al menos 10 caracteres, con mayúscula, minúscula y un dígito.

## 10. Verificar permisos y auditoría

- En la UI, confirma que el usuario ve todas las secciones de
  administrador (Ejecutivos, Roles, Auditoría, Monitor de integración,
  etc.) — el rol `ADMIN` recibe el catálogo completo de permisos.
- En la sección de Auditoría del panel (`audit.read`), busca una entrada
  con `action = admin.bootstrap` para el usuario recién creado/reconciliado
  — confirma que quedó registrada, sin contraseñas ni hashes en el detalle.

## Volver a ejecutar

Si necesitas correr `--apply` de nuevo más adelante (por ejemplo, para
sincronizar un permiso nuevo del catálogo hacia el rol `ADMIN`), es seguro
hacerlo: es idempotente. Ejecuta primero `--check` para confirmar que el
resultado proyectado es el esperado (`RECONCILE` o `NO_CHANGES`, nunca
debería volver a ser `CREATE` para el mismo usuario) antes de repetir
`--apply`.
