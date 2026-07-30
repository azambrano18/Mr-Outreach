# Mr. Outreach — Aplicación web

Panel administrativo y plano de control de **Mr. Outreach**, la plataforma de prospección por
correo de MejoReferido. Este repositorio contiene **únicamente la aplicación web** (backend
NestJS + frontend Next.js). El motor de ejecución (SMTP, IMAP, scheduler, rebotes) es un
componente separado desarrollado por otra persona; esta aplicación solo lo consume a través de
una interfaz desacoplada (`EngineClient`).

La identidad visual (logo, paleta de colores morado/naranja) sale de `logo/mr-logo.png` — ver
"Identidad visual" más abajo.

---

## Puesta en marcha (instalación reproducible desde cero)

Esta sección es la referencia vigente y autocontenida para levantar el proyecto desde un
clon/copia limpia. El resto del README, más abajo, es una bitácora histórica fase por fase — útil
como contexto, pero no la sigas para instalar.

### Requisitos previos

- **Node.js 20 o superior** (probado con Node 24 / npm 11). Sin Docker, sin PostgreSQL, sin el
  motor real — la modalidad simulada (la que se usa para desarrollar hoy) no los necesita.
- npm 10+ (el repo usa `package-lock.json` con `npm workspaces`, no yarn/pnpm).

### 1. Instalar dependencias

```bash
npm install
```

Instala las 3 apps/paquetes del monorepo (`apps/api`, `apps/web`, `packages/*`) en un solo paso
gracias a `npm workspaces` (ver `"workspaces"` en el `package.json` raíz).

### 2. Configurar variables de entorno

Copia las plantillas `*.example` — **nunca copies valores reales entre archivos, generá los tuyos**:

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env        # opcional; solo si necesitás otro PORT/WEB_ORIGIN
cp apps/web/.env.example apps/web/.env.local
```

Editá `./.env` y completá, como mínimo:

- `AUTH_SECRET` — `openssl rand -base64 48`.
- `CREDENTIALS_ENCRYPTION_KEY` — `openssl rand -base64 32` (debe decodificar a exactamente 32 bytes).
- `DEV_ADMIN_PASSWORD` / `DEV_EXECUTIVE_PASSWORD` — cualquier valor que cumpla la política de
  contraseñas (10+ caracteres, mayúscula/minúscula/dígito).

Con `PERSISTENCE_DRIVER=memory` y `ENGINE_DRIVER=mock` (los valores por defecto) no hace falta
`DATABASE_URL` ni `ENGINE_BASE_URL` — ver "Variables de entorno" más abajo para el resto y
"Modalidad simulada vs integrada" para cuándo cambiarlos.

La API **rehúsa arrancar** (falla rápido, nunca a medias) si falta alguna variable obligatoria
para el modo elegido — ver `apps/api/src/infrastructure/config/env.validation.ts` (esquema Joi) y
sus pruebas en `env.validation.spec.ts`.

### 3. Generar el cliente Prisma

```bash
npm run prisma:generate
```

No requiere ninguna base de datos alcanzable — solo lee `prisma/schema.prisma`. Con
`PERSISTENCE_DRIVER=memory` (el default) esto alcanza para levantar la app: `PrismaService` ni
siquiera se instancia en ese modo.

### 4. Migraciones (solo si vas a usar PostgreSQL)

Con `PERSISTENCE_DRIVER=memory` podés saltar este paso — no hace falta ninguna base de datos.
Si vas a probar `PERSISTENCE_DRIVER=postgres`:

```bash
npm run prisma:migrate     # desarrollo — crea/aplica migraciones nuevas si el schema cambió
npm run prisma:deploy      # aplica migraciones ya generadas, sin crear nuevas (uso en Staging/Production)
```

Dos migraciones hoy: `20260730000000_init_mr_outreach` (esquema completo consolidado — reemplaza
la cadena histórica de migraciones incrementales de una base Neon anterior compartida con otro
sistema) y `20260730000001_restore_case_insensitive_unique_indexes` (2 índices únicos parciales
escritos a mano — Prisma no tiene sintaxis declarativa para "único mientras no esté eliminado" ni
para comparación insensible a mayúsculas). Ambas ya se aplicaron realmente, vía `prisma migrate
deploy`, contra los branches `development` y `test` del proyecto Neon dedicado — no son solo SQL
generado sin verificar.

Si tu proveedor usa una conexión *pooled* (PgBouncer/Neon `-pooler`), `schema.prisma` separa
`DATABASE_URL` (runtime, puede ser pooled) de `DIRECT_URL` (solo lo usan los comandos `prisma
migrate`/`db`, debe ser la conexión directa). En un proveedor no-pooled (Hetzner, la mayoría de
instalaciones propias) usá el mismo valor para ambas — ver `.env.example`.

### 5. Seed

- **Modalidad en memoria** (`PERSISTENCE_DRIVER=memory`, el default): el seed corre
  **automáticamente** al arrancar la API (`DevSeedService`) — no hay que ejecutar nada aparte. Crea
  la organización, el catálogo de permisos, los roles y los usuarios `DEV_ADMIN_*`/`DEV_EXECUTIVE_*`
  definidos en tu `.env`.
- **Modalidad PostgreSQL** (`PERSISTENCE_DRIVER=postgres`): el seed es manual y se niega a correr
  si `NODE_ENV=production`:

  ```bash
  npm run prisma:seed
  ```

### 6. Arrancar backend y frontend

```bash
npm run dev
```

Levanta ambos procesos juntos (`concurrently`): API en `http://localhost:3001`
(`/health/live`, `/health/ready`, Swagger en `/docs`) y Web en `http://localhost:3000`. Iniciá
sesión en `http://localhost:3000/login` con las credenciales `DEV_ADMIN_EMAIL`/`DEV_ADMIN_PASSWORD`
que definiste en `.env`.

Para levantarlos por separado: `npm run start:dev -w apps/api` y `npm run dev -w apps/web`.

### 7. Ejecutar en modo simulación (el modo por defecto)

No requiere ningún paso adicional: con `PERSISTENCE_DRIVER=memory` + `ENGINE_DRIVER=mock` +
`MAIL_ENGINE_MODE=simulation` (todos los defaults de `.env.example`) el proyecto entero — datos,
motor de correo — corre sin ninguna infraestructura externa. Ver "Modalidad simulada (la
actual)" más abajo para el detalle de qué hace el seed automático y cómo se simula el motor.

### 8. Ejecutar pruebas

```bash
npm run test        # unitarias — @outreach/validation + apps/api
npm run test:e2e     # end-to-end — apps/api (Jest + Supertest)
```

Corren enteramente en modalidad simulada, usando el `.env.test` de la raíz (versionado a
propósito — solo valores ficticios, nunca secretos reales; ver "Rotación de secretos" más abajo
para la diferencia con los `.env` reales). Ver "Pruebas" más abajo para el detalle de qué cubre
cada suite.

### 9. Compilación productiva

```bash
npm run build
```

Compila en orden: `packages/shared-types` → `packages/validation` → `packages/ui` → `apps/api`
(`nest build`, sale en `apps/api/dist`) → `apps/web` (`next build`, sale en `apps/web/.next`).

### Persistencia PostgreSQL (Fase 1)

```text
Controller / BFF
      ↓
Application Service
      ↓
Repository Port (interfaz de dominio)
      ↓
Memory Adapter  |  Prisma Adapter      ← PERSISTENCE_DRIVER decide cuál, en un solo lugar
      ↓
PostgreSQL
```

`PersistenceModule` (`apps/api/src/infrastructure/persistence/persistence.module.ts`) es el
**único** lugar que decide, por repositorio, si el adaptador activo es el de memoria o el de
Prisma — ningún otro módulo conoce esa decisión, solo inyectan el token del puerto.

**Entidades con adaptador PostgreSQL real desde esta fase** (antes solo existían en memoria):

| Dominio | Modelo Prisma | Notas |
|---|---|---|
| Comandos de integración | `IntegrationCommand` | idempotencyKey único por organización |
| Eventos de integración | `IntegrationEvent` | dedupe por (organización, eventId, origen) |
| Empresas | `Company` | nombre normalizado único por cliente (índice parcial, filas no eliminadas) |
| Contactos | `Contact` | correo único por cliente, sin distinguir mayúsculas (índice parcial) |
| Importaciones de secuencia | `SequenceImport` | agregados/contadores, referencia al archivo (nunca el archivo en sí) |
| Filas de importación | `SequenceImportRow` | **nueva** — antes vivía solo en un `Map` de Node.js, se perdía al reiniciar |
| Contactos en una secuencia | `SequenceContact` | un contacto no puede enrolarse dos veces en la misma secuencia (único) |
| Trabajos programados | `ScheduledEmail` | idempotencyKey único por organización |

**Qué sigue solo en memoria** (fuera del alcance de esta fase): conversaciones y sus mensajes/
notas/etiquetas (`Conversation*`). Van a migrar en una fase posterior.

**Ambos modos siguen soportados:**

```bash
PERSISTENCE_DRIVER=memory     # default — sin PostgreSQL, ideal para pruebas/demo/desarrollo rápido
PERSISTENCE_DRIVER=postgres   # usa las 8 tablas de arriba (y el resto del núcleo) en PostgreSQL real
```

**Ejecutar las pruebas de integración PostgreSQL** (nunca contra tu base de desarrollo — siempre
una base descartable, separada):

```bash
# En una terminal, exportá temporalmente (nunca los guardes en un .env versionado):
export DATABASE_URL="<tu conexión de prueba>"
export DIRECT_URL="<tu conexión directa de prueba, si tu proveedor usa pooling>"
export TEST_DATABASE_URL="$DATABASE_URL"
export NODE_ENV=test
export DATABASE_ENVIRONMENT=test

npm run test:integration -w apps/api
```

Cada suite está protegida por `assertTestDatabaseEnvironment()`
(`apps/api/src/infrastructure/persistence/prisma/test-database-guard.ts`), que exige
simultáneamente `NODE_ENV=test`, `DATABASE_ENVIRONMENT=test`, `TEST_DATABASE_URL` definida, **y**
que `DATABASE_URL` sea exactamente igual a `TEST_DATABASE_URL` — si alguna falla, no se ejecuta
ninguna operación destructiva. `test:integration` corre con `--runInBand` a propósito: varias
suites comparten la misma base real y no deben correr en paralelo.

**Limpiar la base de pruebas:** las specs de contrato solo borran (`deleteMany`) las filas de la
tabla que están probando, nunca `organizations`/`managed_clients`/etc. — son fijos, creados una
vez de forma idempotente (`skipDuplicates: true`) por `apps/api/src/infrastructure/persistence/
prisma/test-fixtures.ts`. Para arrancar de cero manualmente, `TRUNCATE` solo las tablas que
administra Mr Outreach (nunca las de otras aplicaciones que puedan compartir la misma base).

**Modo simulación con PostgreSQL:** no cambia nada del flujo — con `PERSISTENCE_DRIVER=postgres`
y `MAIL_ENGINE_MODE=simulation` (el único modo implementado), los comandos/eventos simulados se
escriben en `integration_commands`/`integration_events` igual que en memoria, sobreviven a un
reinicio de la API, y el panel de monitoreo de integración los sigue mostrando exactamente igual.

**Prueba de reinicio real:** `apps/api/src/infrastructure/persistence/prisma/
restart-durability.integration.spec.ts` crea un comando + sus eventos + una importación + un
contacto + una relación contacto-secuencia + un trabajo programado con una instancia de
`PrismaService`, la desconecta por completo (`$disconnect()`, simulando que el proceso de la API
se apagó), crea una instancia **nueva** y confirma que los seis siguen recuperables — la única
forma en que eso puede pasar es que de verdad estén en PostgreSQL.

### Estructura general del monorepo

Ver "Estructura del repositorio" más abajo para el árbol completo comentado. En resumen:
`apps/api` (NestJS, arquitectura puertos-y-adaptadores), `apps/web` (Next.js App Router),
`packages/shared-types` + `packages/validation` + `packages/ui` (compartidos entre ambas apps),
`prisma/` (schema + migraciones), todo orquestado con `npm workspaces` desde el `package.json`
raíz — sin Lerna, Turborepo ni Nx.

## Rotación de secretos

Cualquier secreto que haya podido circular fuera de este repositorio (por ejemplo, en un ZIP de
entrega, un chat, o un `.env` compartido informalmente) **debe considerarse comprometido y
rotarse manualmente** antes de usar el proyecto en un entorno real. Esta rotación es siempre
manual — ninguna herramienta automatizada de este repositorio se conecta a servicios externos
para rotar credenciales.

Rotar, como mínimo:

- **`AUTH_SECRET`** — generar uno nuevo (`openssl rand -base64 48`) y actualizarlo en cada
  entorno. Rotarlo invalida todas las sesiones activas (los JWT firmados con el valor anterior
  dejan de validar) — esperable y seguro.
- **`CREDENTIALS_ENCRYPTION_KEY`** — generar uno nuevo (`openssl rand -base64 32`).
  **Atención**: rotar esta clave vuelve indescifrables las contraseñas IMAP/SMTP de cuentas de
  correo ya guardadas con la clave anterior — en modalidad PostgreSQL, planificar un
  re-guardado/re-vinculación de esas cuentas después de rotarla.
- **Usuario y contraseña de la base de datos** (`DATABASE_URL`), si `PERSISTENCE_DRIVER=postgres`
  — rotar la contraseña directamente en PostgreSQL/Hetzner y actualizar la cadena de conexión en
  cada entorno.
- **`ENGINE_API_KEY`** — cuando exista un servidor motor real emitiendo tokens.
- **`DEV_ADMIN_PASSWORD`/`DEV_EXECUTIVE_PASSWORD`** — si el `.env` de desarrollo circuló fuera de
  un entorno controlado.
- Cualquier otro valor no listado aquí que haya aparecido en un archivo `.env` (no `.env.example`)
  entregado, compartido o versionado por error.

No se debe intentar conectar a ningún servicio externo para rotar estas credenciales de forma
automática — la rotación la realiza siempre una persona con acceso directo a cada sistema
(PostgreSQL/Hetzner, Neon, el proveedor del motor real).

---

## Panel administrativo: shell, navegación lateral y permisos

Trabajo transversal (no es una fase de negocio nueva) sobre `/dashboard`: hasta ahora cada pantalla
repetía su propia cabecera (marca, botón "Volver", cerrar sesión) y el "menú" era una grilla de
tarjetas en `/dashboard`. Se reemplazó por un shell único (`app/dashboard/layout.tsx` +
`admin-shell.tsx`) con menú lateral fijo, barra superior y área de contenido — todas las pantallas
existentes se reutilizaron tal cual (misma lógica de datos, mismos permisos), solo se les quitó la
cabecera duplicada.

- **Menú lateral** (`admin-sidebar.tsx`, config única en `lib/admin-navigation.ts`): cinco ítems —
  Ejecutivos, Cuentas de Correos, Variables, Firmas, Auditoría — cada uno con su propio ícono
  (`lucide-react`) y el permiso (o lista de permisos, para "cualquiera de estos") que lo hace
  visible. El filtrado es solo cosmético: cada pantalla destino sigue verificando el permiso por su
  cuenta y las rutas de API siguen protegidas por sus guards — quitar el ítem del menú nunca es la
  única barrera. **"Textos" ya no es un ítem del menú** (ver Fase 9 más abajo) — el módulo
  `templates` sigue existiendo intacto (rutas, DTOs, tabla) para reutilizarse como contenido de un
  step de secuencia el día que esa fase se construya, simplemente no tiene entrada propia en el
  sidebar.
- **"Cuentas de Correos" cubre dos pantallas reales**: `/dashboard/mail-accounts` es otro alias que
  redirige a `/dashboard/mailboxes` (admin, `mailboxes.read.all`) o a `/dashboard/mailboxes/mine`
  (ejecutivo, `mailboxes.read.assigned`) según el permiso del usuario — la misma resolución que ya
  existía en el grid viejo, ahora vive en esta única ruta.
- **"Firmas" y "Auditoría" son pantallas temporales**: no existe todavía un listado de firmas
  independiente de una cuenta (una firma se administra desde la ficha de su `Mailbox`) ni un
  endpoint de lectura para el log de auditoría (`AuditLogRepository` ya registra internamente, pero
  no hay `GET /audit` ni controlador). Ambas rutas están protegidas por su permiso real
  (`signatures.read` / `audit.read`) y muestran un estado "en construcción" en vez de datos o
  formularios simulados.
- **Responsive**: el sidebar es fijo en escritorio (`lg:` = 1024px+), colapsable a solo íconos con
  tooltip (ancho persiste en `localStorage` bajo `admin-sidebar-collapsed`, leído recién en un
  `useEffect` para no romper la hidratación) y se convierte en un drawer con overlay por debajo de
  ese ancho — cierra con clic en el overlay, con `Escape`, o al elegir una opción, y bloquea el
  scroll del fondo mientras está abierto.
- **Página principal** (`/dashboard`) quedó como un estado "en construcción" (`construction-state.tsx`)
  hasta que exista un dashboard de métricas real.

## Ajuste 2 — Notificaciones, terminología prospecto/contacto, resultado de la respuesta, y retiro del frontend de secuencias

Segundo pase de ajustes sobre "Cuentas de correos" (ver "Ajuste" más abajo para el primero), a
partir de feedback directo tras probar la entrega anterior en vivo.

### Notificaciones: identificar la conversación y limpiar la alerta

- **Campana** (`notification-bell.tsx`): abrir un ítem lo remueve de la lista de forma optimista
  (antes de navegar) en vez de esperar el refetch de 800ms — la alerta desaparece al instante. Abrir
  la campana marca todos los ítems listados como "vistos" (IDs en un `Set` persistido en
  `sessionStorage`, mismo patrón que el árbol de cuentas) — el badge numérico solo cuenta los no
  vistos, así que una respuesta nueva sigue apareciendo aunque ya se haya abierto la campana antes.
  Esto es un concepto deliberadamente distinto de "leído" (que sigue ocurriendo solo al abrir la
  conversación misma).
- **Identificación de la conversación** (`accounts-workspace.tsx`): la lista de conversaciones
  (columna 2) y los ítems de la campana ahora muestran primero la **empresa** (Prospecto) y luego el
  contacto, con un punto indicador visible junto a las conversaciones no leídas — antes solo había
  negrita, insuficiente para distinguir cuál conversación específica tenía la respuesta pendiente
  dentro de una cuenta con varias.

### Terminología: Prospecto = empresa, Contacto = persona

El modelo de dominio (`Company`/`Contact`) ya estaba bien alineado — el problema era que la capa de
conversaciones usaba "prospecto" para referirse a la persona. Se corrigió en todo el flujo:
`ConversationSummary.prospectStatus` → **`contactStatus`** (backend, `shared-types`, frontend), y el
bloque de trazabilidad de la conversación pasa a mostrar explícitamente:

```
Secuencia: …
Step: …
Prospecto: {empresa}
Contacto: {persona}
Estado: {estado de participación del contacto en la secuencia}
```

### Resultado de la respuesta — reemplaza Estado/Clasificación/Responsable/Etiqueta y el menú de 3 puntos

La fila de controles operativos (pensada originalmente para el Centro de conversaciones del admin)
no tenía un propósito claro para el ejecutivo. Se reemplazó por un modelo de negocio real con 4
resultados posibles, cada uno con un efecto distinto — y **reemplaza** también las acciones
Pausar/Reanudar/Finalizar/No contactar que antes vivían en el menú de 3 puntos:

- **No interesado** / **Interesado**: ambos detienen la secuencia para **toda la empresa** del
  contacto que respondió (reutilizando `SchedulingService.cancelFutureJobsForCompany`, el mismo
  mecanismo que ya usaba "retirar empresa" del admin) — no solo al contacto individual. Difieren
  solo en el resultado registrado (`Conversation.responseOutcome`) y el motivo, ya que "interesado"
  implica que la gestión comercial continúa por fuera de la secuencia.
- **No contactar**: sin cambios de lógica respecto al ajuste anterior — exclusión global
  (`Contact.suppressed`) para esa única dirección de correo, nunca para el resto de la empresa.
- **Deriva**: saca al contacto que respondió de la secuencia (`SequenceContact.status: REMOVED`) y
  matricula a un contacto nuevo dentro de la misma empresa/secuencia
  (`SchedulingService.enrollAcceptedContacts`, el mismo mecanismo que usa la importación CSV) con la
  opción de enviarle "Enviados_1" de inmediato — nuevo método
  `SchedulingService.sendFirstStepNow`, deliberadamente aislado de `createBatch` para no arrastrar
  al resto de contactos vencidos de la secuencia en el mismo envío.

Nuevo servicio `ResponseOutcomeService` (reemplaza `ProspectActionsService`), mismos permisos ya
otorgados al ejecutivo (`sequence_contacts.remove`/`sequence_contacts.suppress`, sin permisos
nuevos), mismo contrato de comando versionado (`PROSPECT_SEQUENCE_ACTION`) hacia el motor simulado.
El menú de 3 puntos de la conversación vuelve a ser solo "Marcar leído/no leído" + "Ver texto
plano/HTML".

### Retiro del frontend de creación/gestión de secuencias (backend intacto)

El usuario pidió "limpiar" la funcionalidad de secuencias para reconstruirla después con reglas más
ordenadas. Investigación previa a tocar código confirmó que el **backend** de secuencias (crear
secuencia/steps, importar CSV, agendar, enviar) es la única vía por la que llegan a existir
`SequenceContact`s — lo usan los tests e2e y las propias acciones de resultado de respuesta de este
mismo ajuste. Alcance acordado con el usuario: se borran solo las **páginas y componentes de
frontend** de creación/gestión (`components/sequences/*` completo, las rutas
`/dashboard/executives/[id]/sequences/*` y `/dashboard/sequences/mine/*`, y sus rutas BFF), dejando
el backend (`SequencesController`, `SequenceStepsController`, `MeSequenceImportsController`,
`MeSchedulingController`, etc.) completamente intacto. La pestaña "Secuencias" del perfil de
ejecutivo (admin) pasa a un estado "en construcción" (mismo patrón ya usado para "Firmas"/
"Auditoría").

**Especificación para la reconstrucción futura** (no implementada todavía, documentada aquí como
el norte de ese trabajo):
- Nombre de secuencia **no editable**: se genera automáticamente como `Gestión_DDMMYYYY` a partir de
  un selector de calendario, sin campo de texto libre.
- Nombres de step limitados a un **listado fijo**: `Enviados_1`, `Enviados_2`, `Enviados_3`, en vez
  de edición libre de nombre.

### Pruebas

`response-outcome.e2e-spec.ts` (nuevo, reemplaza `prospect-actions.e2e-spec.ts`) cubre: no
interesado con dos contactos de la misma empresa (verifica que ambos quedan detenidos, no solo el
que respondió), interesado, no contactar (incluyendo el 409 al reintentar), y deriva (contacto
viejo `REMOVED`, contacto nuevo creado/matriculado con envío inmediato verificado). Suite completa
de nuevo en verde tras el cambio.

### Pendiente explícito (fuera de esta entrega)

- La reconstrucción real del módulo de secuencias (nombre por calendario, steps fijos) — solo
  especificada arriba, no construida.
- Mismas limitaciones ya aceptadas en ajustes anteriores (notificaciones no son tiempo real, sin
  paridad Prisma/Postgres, `RemoteMailEngineAdapter` sin implementar).

## Ajuste — Cuenta del ejecutivo: enfoque exclusivo en revisión de respuestas y trazabilidad (sobre Fase 12)

Ajuste de alcance sobre la cuenta del ejecutivo, no una fase nueva: la superficie visible para este
rol se reduce a "Cuentas de correos" y esa pantalla se reconstruye sobre el modelo persistido de
`Conversation`/`SequenceContact` (Fase 11 + Fase 12) en vez del `MailWorkspace` de IMAP en vivo
(Fase 10) que usaba antes. El Centro de conversaciones del administrador (`/dashboard/conversations`)
no se tocó.

- **Sidebar del ejecutivo**: se retiró el ítem "Secuencias" de `lib/admin-navigation.ts` (estaba
  gateado únicamente por `sequences.manage.own`, un permiso que ningún administrador usa desde ahí)
  y se angostaron los permisos de "Clientes" y "Centro de conversaciones" a sus variantes `.all`
  — el ejecutivo queda con un único ítem, "Cuentas de correos". La campana de notificaciones y el
  menú de usuario siguen en la barra superior para ambos roles.
- **"Cuentas de correos" pasa a ser un árbol Cliente → Dominio → Cuenta → Conversaciones**
  (`AccountsTree`/`AccountsWorkspace`, alimentados por `GET /me/conversations/tree`), reemplazando
  la lista plana de cuentas de `MailWorkspace`. Cada nivel expone un contador de no leídos agregado
  hacia arriba (cuenta → dominio → cliente); qué nodos quedaron expandidos se recuerda en
  `sessionStorage` durante la sesión.
- **Campana de notificaciones** (`notification-bell.tsx`): sondeo cada 20s (no hay WebSocket/SSE en
  este backend, se dejó explícito en vez de simular tiempo real) contra un listado centralizado de
  respuestas no leídas con cliente/dominio/cuenta/prospecto/empresa/asunto/fecha/preview. Al hacer
  clic navega dentro de la SPA hasta la conversación exacta (expande cliente → dominio → cuenta →
  abre el hilo) sin recarga completa.
- **Marcar como leído es ahora un efecto secundario explícito y opt-in**: `ConversationsService.getById`
  ganó `options: { markAsRead?: boolean }` (por defecto `false`) — solo `getByIdForExecutive` y el
  `getById` del controlador admin (los dos puntos de entrada que realmente representan "el usuario
  abrió esto") pasan `true`. Se dejó así deliberadamente después de encontrar, durante las pruebas,
  que la versión incondicional marcaba conversaciones como leídas dentro de un enriquecimiento
  interno (`MeReplySimulationController` llamando a `getById` sobre su propio resultado) antes de
  que el ejecutivo llegara a verlas, lo que rompía en silencio la campana de notificaciones.
- **Menú de tres puntos de la conversación**: se eliminó por completo Responder/Responder a
  todos/Archivar (sin dejar rastro deshabilitado) y se agregaron tres acciones nuevas sobre el
  prospecto de esa conversación específica — nunca sobre la empresa completa:
  - **Pausar secuencia para este prospecto** → `PAUSED`, reversible con "Reanudar".
  - **Finalizar secuencia para este prospecto** → `COMPLETED_MANUALLY`, un estado nuevo y
    deliberadamente distinto de `COMPLETED` (que sigue significando "completó la secuencia
    naturalmente"), para no mezclar cierre manual del ejecutivo con avance normal en reportes.
  - **Marcar como "No contactar"** → reutiliza `Contact.suppressed` (el mismo campo de exclusión
    global de la Fase 12) y afecta únicamente la dirección de correo que respondió, nunca a los
    demás contactos de la misma empresa.
  Las tres reutilizan mecanismos ya existentes de la Fase 12 (`SchedulingService.cancelFutureJobsForContact`,
  el mismo que usa "Retirar contacto") y los permisos ya otorgados al ejecutivo
  (`sequence_contacts.remove`, `sequence_contacts.suppress`) — no se agregaron permisos nuevos.
  Cada acción genera un comando `PROSPECT_SEQUENCE_ACTION` versionado hacia el motor simulado
  (nuevo `CommandType`/`EventType` en `envelopes.ts`) con el mismo contrato de idempotencia/auditoría
  del resto de la Fase 12.
- **Bloque de información de la conversación** se recortó a Secuencia relacionada / Step
  relacionado / Prospecto relacionado / Estado del prospecto — cliente/dominio/cuenta ya no se
  repiten ahí porque son visibles en la navegación jerárquica.
- **`SequenceContactRepository` ganó `findByContact`** (antes solo existía `findByContactAndSequence`)
  porque "No contactar" necesita cancelar la participación de un contacto en *todas* las secuencias
  en las que esté, no solo en la de la conversación actual.

### Pruebas

`prospect-actions.e2e-spec.ts` (nuevo en su momento) cubrió pausar/reanudar, finalizar, marcar "No
contactar" y la agregación del árbol de no leídos, con una aserción de regresión explícita para el
bug de marcado-como-leído prematuro descrito arriba. Suite completa: 134/134 tests e2e pasando en
esa entrega. Además, un smoke test manual con Playwright recorrió el flujo completo por la interfaz
real confirmando que también funcionaba de punta a punta fuera de los tests automatizados.

**Nota:** Pausar/Reanudar/Finalizar y el archivo `prospect-actions.e2e-spec.ts` fueron
reemplazados en el siguiente ajuste (ver "Ajuste 2" más abajo) por el modelo de resultado de
respuesta (No interesado/No contactar/Interesado/Deriva) y `response-outcome.e2e-spec.ts` — se deja
esta sección tal cual como registro histórico de lo que se entregó en este pase.

### Pendiente explícito (fuera de esta entrega)

- **Notificaciones no son tiempo real**: sondeo cada 20s en el cliente, no hay infraestructura de
  WebSocket/SSE en este backend.
- **"Marcar como no leído" manual** no tiene endpoint dedicado — el toggle de lectura en la
  interfaz solo soporta la transición no-leído → leído.
- Mismas limitaciones ya aceptadas en la Fase 12 (sin paridad Prisma/Postgres para las entidades
  nuevas, `RemoteMailEngineAdapter` sin implementar).

## Fase 12 — Modo de simulación completo del motor de correo (comandos, eventos, Outbox/Inbox)

Pivote arquitectónico grande: Mr Outreach pasa de "configura y opera contra un motor mock
síncrono" a **"configura y administra; un motor separado ejecuta"**, con un contrato explícito de
comandos/eventos entre ambos. Todavía no existe conexión con un motor remoto real — esta fase
entrega un **modo de simulación completo** (`MAIL_ENGINE_MODE=simulation`) que genera los mismos
JSON, los mismos estados y los mismos eventos que generaría un motor real, procesados por un
adaptador simulado en vez de una llamada de red. El adaptador remoto (`RemoteMailEngineAdapter`)
existe como contrato compilable, deliberadamente sin implementar (ver "Pendiente explícito").

Antes de escribir código se auditó el estado real de: organizaciones/usuarios/roles/permisos,
jerarquía Cliente→Dominio→Cuenta (Fase 11), secuencias y steps, `EngineClient` (el puerto síncrono
existente — probar conexión, enviar prueba, leer bandeja bajo demanda), almacenamiento de
imágenes, auditoría, y el hallazgo que gobernó el diseño: **no existía ningún modelo de
Contacto/Empresa/Importación/Job/Comando/Evento en todo el backend** — todo lo de esta fase es
aditivo, no hay nada que migrar ni ningún endpoint/entidad que duplicar.

### El puerto nuevo convive con el puerto viejo — no lo reemplaza

`EngineClient` (probar conexión IMAP/SMTP, enviar correo de prueba, leer bandeja bajo demanda) es
un puerto síncrono de petición/respuesta y sigue exactamente igual — la Fase 11 entera (Centro de
conversaciones, sincronización on-demand) depende de él y no se tocó. `MailEnginePort` (nuevo,
`domain/integration/mail-engine-port.ts`) es un puerto distinto para el flujo asíncrono que esta
fase agrega: aprovisionar una cuenta, publicar una secuencia, importar contactos, programar y
simular envíos, simular respuestas. Dos puertos, dos responsabilidades, cero solapamiento.

```
MailEnginePort
├── SimulatedMailEngineAdapter   (MAIL_ENGINE_MODE=simulation — el que se usa hoy)
└── RemoteMailEngineAdapter      (MAIL_ENGINE_MODE=remote — contrato listo, sin implementar)
```

### Contratos de comando/evento (`domain/integration/envelopes.ts`)

Todo comando y todo evento comparte un sobre (`CommandEnvelope`/`EventEnvelope`) con
`schemaVersion`, `commandId`/`eventId`, tipo, `idempotencyKey` (solo comandos),
`organizationId`, `correlationId`, `requestedBy`/`occurredAt`, `payload`. Cinco tipos de comando
(`MAILBOX_PROVISION_REQUESTED`, `SEQUENCE_PUBLISH_REQUESTED`, `SEQUENCE_IMPORT_REQUESTED`,
`SEQUENCE_CONTACT_REMOVE_REQUESTED`, `SEQUENCE_COMPANY_REMOVE_REQUESTED`) y sus eventos
correspondientes (aprovisionamiento en 4 pasos IMAP/SMTP, publicación, importación con lotes,
retiro, más `INBOUND_REPLY_MATCHED`/`INBOUND_REPLY_UNMATCHED` — estos dos sin comando de origen,
igual que un motor real: una respuesta llega detectada, nadie la solicitó).

### Outbox/Inbox e idempotencia (`IntegrationService`)

`IntegrationCommand` (Outbox) e `IntegrationEvent` (Inbox) son las dos tablas persistidas nuevas
que todo lo demás usa. `IntegrationService.submit()` es el único punto de entrada para crear un
comando: busca primero por `idempotencyKey` (§43 — un reenvío con la misma clave **reutiliza el
comando anterior**, nunca crea uno nuevo ni vuelve a invocar el puerto, probado explícitamente en
`mailbox-provisioning.e2e-spec.ts`), y solo si no existe lo crea y lo envía. `redact()` reemplaza
recursivamente cualquier clave llamada `password`/`secret`/`credentialReference`... — no, de hecho
`credentialReference` es una referencia falsa (`secret_ref_demo_<id>`) y se muestra tal cual; solo
`password`/`secret`/`secretCiphertext`/`apiKey`/`token` se vuelven `"[REDACTED]"`. `advance()`
avanza el Outbox: calcula la lista completa y determinística de eventos planeados
(`SimulatedMailEngineAdapter.planEvents()`, una función pura que siempre devuelve los mismos
eventos con los mismos `eventId` para el mismo comando — así "avanzar" repetidamente nunca duplica
un evento ya registrado) y graba solo los que faltan, uno (`mode: 'ONE'`) o todos (`'ALL'`) según
pida quien llama — así queda cubierto tanto el avance automático como el manual (§42) sin dos
implementaciones distintas. `recordDirectEvent()` es la excepción: para `INBOUND_REPLY_MATCHED`/
`_UNMATCHED`, que no tienen comando de origen, escribe directo al Inbox.

### Aprovisionamiento de cuenta (§8-12)

`Mailbox` gana `provisioningStatus` (`NOT_PROVISIONED/PROVISION_REQUESTED/PROVISIONING/
PROVISIONED/PROVISION_FAILED` — nuevo), `timezone` y `sendingLimits` (`dailyLimit`,
`minimumIntervalSeconds`, `maximumIntervalSeconds` — nuevos, con default 40/60s/180s, usados por
el simulador de lotes más abajo). El `connectionStatus` que ya existía se **reutiliza** para
IMAP/SMTP en vez de inventar un tercer enum paralelo; "Estado operativo" (`DRAFT/READY/PAUSED/
SUSPENDED/ERROR/ARCHIVED`) es **calculado**, nunca persistido (`MailboxesService.
computeOperationalStatus()`), derivado de los tres campos anteriores. `MailboxProvisioningService`
arma el JSON exacto del §10 (`credentialReference` en vez de la contraseña real — nunca se
descifra el secreto para esto) y lo somete vía `IntegrationService.submit()`; el escenario
elegido (`SUCCESS/IMAP_ERROR/SMTP_ERROR/AUTH_ERROR/TIMEOUT/GENERAL_FAILURE`) decide qué eventos
planea el simulador (aceptado → iniciado → IMAP validado → SMTP validado → completado, o un fallo
en cualquier punto de esa cadena).

### Publicación de secuencias — versión, calendario, políticas (§14-16)

`Sequence` gana `schedule` (`days`/`windows`), `policies` (`stopOnReply/stopOnHardBounce/
stopOnUnsubscribe/prioritizeFollowUps`), `sequenceVersion` (arranca en 0), `lastPublishedAt`,
`lastPublishCommandId` — todos nuevos. "Publicar secuencia" (`SequencePublishService`, solo
autoservicio — el flujo obligatorio de esta fase publica siempre como ejecutivo) arma el payload
completo con cada step activo y **su propia versión** (reutiliza el versionado por step que ya
existía desde la Fase 10, `SequenceStepVersion` — no se inventó un segundo mecanismo de
versionado), incrementa `sequenceVersion`, y — a diferencia del aprovisionamiento — avanza el
comando **hasta completarlo en el mismo request** (`SEQUENCE_PUBLISH_ACCEPTED`/`_COMPLETED` son
casi instantáneos y el flujo obligatorio no pide un control paso a paso para esta acción en
particular, sí para aprovisionamiento).

### Importación de contactos vía CSV (§17-22)

`papaparse` es la única dependencia nueva del backend (no existía ninguna librería de CSV/Excel
en el monorepo — confirmado por grep antes de decidir agregarla). **Excel (.xlsx) queda fuera de
esta pasada deliberadamente** — CSV es uno de los dos formatos pedidos y es el que resuelve el
flujo obligatorio; Excel es una extensión aislada para otra iteración.
`SequenceImportsService.upload()` guarda las filas crudas en un `Map` en memoria del propio
servicio (nunca en el JSON del comando — el `storageReference` que sí viaja en
`SEQUENCE_IMPORT_REQUESTED` es `{ storageKey, checksum, expiresAt }`, exactamente la forma
contractual que pide §18, aunque el almacenamiento detrás sea local/simulado) y calcula un
checksum SHA-256 real del archivo. `setMappingAndValidate()` valida fila por fila (formato de
correo, duplicados dentro del archivo, contactos/empresas en exclusión global) sin tocar la base
todavía; solo al confirmarse el comando y simularse su finalización se materializan
`Company`/`Contact` reales y se auto-inscriben en el primer step **publicado** de la secuencia
(§21 — si no hay ninguno, la importación queda `FAILED` con el motivo explícito, nunca se marca
completada con cero contactos). El visor JSON es un `<pre>` con formato + copiar + descargar — no
existe ninguna librería de resaltado de sintaxis JSON en el monorepo (confirmado antes de
decidir), y §40 permite explícitamente omitir el resaltado cuando no hay una ya instalada.

### Empresas normalizadas, sin fusión automática (§29)

`Company` (nueva) guarda `rawName` (el texto tal cual se importó) y `normalizedName`
(`normalizeCompanyName()`: minúsculas, sin acentos, espacios colapsados, sin puntuación, sin
sufijos legales `s.a./sa/spa/ltda/inc/llc`) — la clave de coincidencia para detectar "posible
duplicado" nunca se usa para fusionar automáticamente. `Contact` referencia `companyId`, nunca un
nombre de empresa libre. Ambas entidades tienen `suppressed`/`suppressedAt`/`suppressedReason`
— la exclusión **global** (§30), deliberadamente distinta de "retirado de esta secuencia".

### Scheduler simulado: lotes, prioridad de seguimientos, retraso desde el envío real (§21-25)

`SchedulingService.createBatch()` es "Crear lote": toma cada `SequenceContact` activo cuyo step
actual todavía no tiene un job, **ordena los seguimientos (posición > 1) antes que los prospectos
nuevos** (§23), limita el lote al `dailyLimit` de la cuenta remitente, y calcula `scheduledAt` de
cada uno desde el **propio `lastSentAt` del contacto** más el retraso del step — nunca desde
"ahora" ni desde la fecha de importación (§22, probado explícitamente con un `lastSentAt` en el
futuro para aislar la aserción del piso "nunca antes de ahora" que el propio método también
aplica). No existe una entidad `Batch` separada — `batchId` es solo una clave de agrupación en
`ScheduledEmail`, evitando una entidad más de las que ya eran necesarias. `simulateSend()` es
"Simular envío": al marcar `SENT` genera un `Message-ID` determinístico
(`<outbound_<id>@mailengine.mroutreach.local>`, §32) con `In-Reply-To`/`References` encadenados
al envío anterior del mismo contacto, y **congela una instantánea inmutable** del asunto/cuerpo
enviados (§31) directamente en la fila `ScheduledEmail` — se decidió no crear una entidad
`OutboundMessage` separada porque `ScheduledEmail` ya es 1:1 con "el envío de un step a un
contacto"; una vez `SENT`, esos campos nunca se vuelven a tocar aunque el step se edite después.

### Retirar contacto / retirar empresa (§27-28)

`SequenceContactsService.removeContact()`/`removeCompany()` generan
`SEQUENCE_CONTACT_REMOVE_REQUESTED`/`SEQUENCE_COMPANY_REMOVE_REQUESTED`, cancelan (nunca borran)
los jobs futuros todavía no enviados de ese contacto o de **todos** los contactos de esa empresa
**dentro de esa secuencia únicamente** (nunca una exclusión global — esa es la acción separada de
"suprimir", §30), y devuelven el conteo real de jobs cancelados. El historial de envíos/respuestas
se conserva siempre.

### Simular respuesta — asociación exacta al step, nunca al último enviado (§33-36)

`ReplySimulationService.simulateReply()` no tiene comando de origen (igual que un motor real:
nadie "pide" que llegue una respuesta) — escribe directo al Inbox vía
`IntegrationService.recordDirectEvent()`. El escenario elegido **es** literalmente
`ConversationClassification` (ese tipo, de la Fase 11, ya cubre exactamente la lista de §33) más
`'UNIDENTIFIED'` aparte para `INBOUND_REPLY_MATCHED` vs `_UNMATCHED`. La asociación al step exacto
es automática y correcta por construcción: cada `ScheduledEmail` ya sabe su propio
`sequenceStepId`, así que "simular respuesta" siempre se hace sobre un envío `SENT` concreto — no
existe ambigüedad que resolver con una cadena de prioridades (§34) porque el dato nunca se pierde
en el camino. Un contacto puede tener varios envíos `SENT` (uno por step); la prueba en vivo de
esta fase respondió deliberadamente al Seguimiento 2 mientras el Envío 1 también estaba `SENT`,
para demostrar que la respuesta se asocia al step correcto y no al último enviado. Según la
clasificación: rebote permanente y cancelación detienen el contacto **y** lo suprimen
globalmente; una respuesta humana normal detiene el contacto (nunca lo suprime); fuera de oficina
y respuesta automática no detienen nada (política por defecto: no asumir interés ni desinterés);
rebote temporal tampoco detiene (no es necesariamente definitivo). Detener siempre cancela los
jobs futuros de ese contacto — el mismo `SchedulingService.cancelFutureJobsForContact()` que usa
"retirar contacto".

### `Conversation` gana trazabilidad real (Fase 11 + Fase 12 conviven)

`Conversation` gana `contactId`/`companyId`/`sequenceContactId`/`originatingScheduledEmailId`
(todos nuevos, todos nulables). Dos caminos crean filas de `Conversation` y ambos siguen vigentes:
la sincronización on-demand de la Fase 11 (`ConversationsService.syncMailbox`, sin `Contact` real
detrás, campos nuevos en null) y esta fase (`ReplySimulationService`, con `Contact`/`Company`/
`SequenceContact` reales detrás). El Centro de conversaciones resuelve "step de origen" navegando
`originatingScheduledEmailId → sequenceStepId` — nunca adivina. Ningún botón de responder se
habilitó: los que ya existían (deshabilitados desde la Fase 11) siguen deshabilitados.

### Monitor de integración (§37-40)

`/dashboard/integration-monitor` (admin, `integration_commands.read`/`integration_events.read`
para ver, `simulation.manage` para avanzar/reprocesar) — pestañas Resumen/Comandos/Eventos.
**Alcance recortado deliberadamente**: el pedido original describe ocho pestañas
(Resumen/Comandos/Eventos/Importaciones/Jobs/Lotes/Mensajes simulados/Escenarios) — las cinco
restantes ya tienen su propia pantalla dedicada y mejor contextualizada (la importación dentro de
la secuencia, los jobs/lotes en el panel de "Prospectos y envíos", los escenarios como selector
en el lugar donde se usan), así que este monitor cubre solo la vista transversal por comando/
evento que ninguna otra pantalla ofrece, en vez de duplicar esos datos en una segunda vista.
`reprocessEvent()` es idempotente por diseño: los efectos de cada evento ya se aplicaron una vez
al registrarse (en el `applyEvent` del servicio de dominio correspondiente), así que reprocesar
solo vuelve a marcar la fila del Inbox como procesada y audita la acción, sin repetir el efecto.

### Permisos nuevos

`mailboxes.provision`, `sequences.publish`, `sequence_imports.create/.read/.cancel`,
`sequence_contacts.read/.remove/.suppress` (esta familia cubre también la variante "empresa" —
retirar/suprimir una empresa es la misma acción a escala de varios contactos, no se duplicó el
permiso), `integration_commands.read/.retry`, `integration_events.read/.retry`,
`simulation.manage`. El rol `EXECUTIVE` recibe `sequences.publish` y toda la familia
`sequence_imports.*`/`sequence_contacts.*` (self-service); `mailboxes.provision`,
`integration_commands.*`, `integration_events.*` y `simulation.manage` quedan **solo admin** — el
flujo obligatorio de esta fase aprovisiona como administrador y todo lo demás como ejecutivo, así
que ese reparto no es una suposición, es literalmente cómo se probó.

### Frontend nuevo

- **`components/integration/json-viewer.tsx`** y **`status-badge.tsx`** — únicos componentes
  verdaderamente compartidos de todo el frontend hasta ahora (`packages/ui` seguía vacío,
  confirmado antes de decidir: cada pantalla previa define su propio badge local). Se justifica
  la extracción real porque esta fase agrega cinco enums de estado nuevos a la vez.
- **Aprovisionamiento**: nueva sección en `/dashboard/mailboxes/:id/edit` (reemplaza el
  placeholder "Límites de envío" — ahora hay datos reales que mostrar ahí).
- **Secuencia**: `PublishPanel`, `ImportWizard` (subir → mapear → validar → confirmar → JSON →
  escenario → simular) y `ExecutionPanel` (contactos, empresas, envíos programados, simular
  envío/error, simular respuesta, retirar contacto/empresa) — las tres nuevas, apiladas debajo de
  `StepList` en `/dashboard/sequences/mine/:sequenceId`, mismo patrón de secciones independientes
  que ya usaba esa página.
- **`/dashboard/integration-monitor`** — nueva, agregada a `admin-navigation.ts`.
- **Centro de conversaciones**: agrega Empresa y "Step de origen" a la cabecera del detalle —
  aditivo, el mensaje de solo-lectura y los botones deshabilitados no se tocaron.

### Validado

**Backend**: build, lint, 281 pruebas unitarias y 130 e2e (dos suites nuevas:
`mailbox-provisioning.e2e-spec.ts` y `sequence-simulation-flow.e2e-spec.ts` — esta última repite
en HTTP puro, sin UI, la cadena completa publicar→importar→programar→enviar→retirar→responder del
flujo obligatorio de abajo) en verde. **Frontend**: build y lint en verde.

**Validado en vivo (Playwright, `chromium`) — flujo obligatorio de esta fase**, contra los
servidores de desarrollo reales, navegando la interfaz (no solo llamando a la API):

```
Ingresar como administrador → Registrar cuenta de correo → (vincular a cliente/dominio y asignar
al ejecutivo — ver nota debajo) → Solicitar aprovisionamiento → Ver JSON → confirmar credenciales
redactadas (contraseñas nunca aparecen; credentialReference sí, como referencia falsa) → elegir
escenario Éxito → simular evento por evento → simular todo → confirmar cuenta "Aprovisionada" /
"Operativo: Lista"
→ Ingresar como ejecutivo → Crear secuencia → adjuntar cuenta remitente → crear Envío 1,
Seguimiento 2, Seguimiento 3 (los tres publicados) → Publicar secuencia → ver JSON
SEQUENCE_PUBLISH_REQUESTED (v1) → cargar CSV con 4 contactos en 3 empresas → mapeo automático →
validar (4 válidas, 3 empresas detectadas) → confirmar → ver JSON SEQUENCE_IMPORT_REQUESTED →
simular contactos aceptados → crear lote Envío 1 (4) → simular los 4 envíos → crear lote
Seguimiento 2 (4) → simular los 4 envíos → crear lote Seguimiento 3 (4, quedan pendientes
deliberadamente) → retirar un contacto (1 job cancelado) → retirar una empresa (2 jobs cancelados,
2 contactos afectados) → simular respuesta "Interesado" al envío de Seguimiento 2 del contacto
restante → confirmar evento INBOUND_REPLY_MATCHED asociado exactamente a "Seguimiento 2" (no al
último enviado) → abrir Centro de conversaciones → confirmar cliente/dominio/cuenta/empresa/step
de origen visibles y que los botones de responder existen pero están deshabilitados → volver como
administrador → Monitor de integración → confirmar el comando de aprovisionamiento listado junto
a los demás.
```

Nota sobre el paso "vincular a cliente/dominio y asignar al ejecutivo": crear un cliente, crear un
dominio y vincular una cuenta a un dominio **no tienen interfaz todavía** — un vacío que ya venía
documentado como pendiente desde la Fase 11 ("CRUD de administrador… no se construyó el
formulario"), no algo nuevo de esta fase. Esos tres pasos se hicieron por API directa (mismo
patrón que ya usan los e2e de Fase 11); todo lo demás del flujo — que es lo que esta fase
realmente agrega — se hizo navegando la interfaz real.

### Pendiente explícito (fuera de esta entrega)

- **`RemoteMailEngineAdapter` no está implementado** — lanza un error explícito en cada método.
  El contrato (`MailEnginePort`) y el mecanismo de selección (`MAIL_ENGINE_MODE=remote`) sí están
  listos; sustituirlo por un cliente HTTP/mensajería real es directo desde acá.
- **Sin paridad Prisma/Postgres** para ninguna entidad nueva de esta fase (mismo patrón ya
  aceptado en la Fase 11 y por la misma razón: este proyecto nunca ejecutó una migración contra
  una base real).
- **Excel (.xlsx)** en la importación — solo CSV.
- **Cinco de las ocho pestañas del Monitor de integración pedidas** no se duplicaron como vista
  separada (ver la sección de arriba) — sus datos ya están en otras pantallas.
- **CRUD de administrador para clientes/dominios/vinculación cuenta↔dominio** en la interfaz —
  pendiente desde la Fase 11, no resuelto acá tampoco.
- **Firma en la instantánea del envío simulado**: `ScheduledEmail` guarda asunto/HTML/texto
  enviados, pero no una copia de la firma activa en ese momento (el campo existe en el dominio,
  `signatureSnapshot`, pero el simulador de envíos no la completa todavía — la firma de la cuenta
  se resuelve en vivo, no se pierde, solo no queda congelada en el historial).
- **Firma de la conversación**: el mensaje "necesita firma activa" en el panel de secuencia sigue
  viniendo de la Fase 10 sin cambios — no es parte de este pivote.

## Fase 11 — Centro de conversaciones: jerarquía Cliente → Dominio → Cuenta, y el fin del concepto "bandeja de correo"

Pivote funcional grande: Mr Outreach deja de organizarse por cuenta de correo y de comportarse
como un cliente de correo de solo lectura, y pasa a organizarse por **cliente administrado**
(`ManagedClient` — el negocio cuya prospección se opera desde acá, ej. "Vertex" — deliberadamente
distinto de `Organization`, que sigue siendo solo el tenant de Mr Outreach, ej. "MejoReferido").
Jerarquía nueva: `Cliente → Dominio → Cuenta de correo → Conversaciones`. La antigua "bandeja de
entrada" (Fase 10, dos y tres columnas sobre hilos leídos en vivo desde el motor, sin persistir
nada) se reemplaza por un **Centro de conversaciones**: un panel de solo lectura y gestión
operativa (clasificar, etiquetar, tomar notas, asignar responsable, resolver/reabrir) sobre
conversaciones que ahora sí se **persisten** como entidades propias — la diferencia central del
pivote.

Antes de escribir código se auditó (agente de exploración) el estado real de: el modelo
multiempresa, `Mailbox`, la relación cuenta-ejecutivo, secuencias, y — el hallazgo más importante —
que **la bandeja nunca persistió nada**: `MailboxesService.getInbox/getThread` siempre fueron
lectura directa al `EngineClient` (mock o motor real), recalculada en cada request, y que **no
existe ningún scheduler/worker/cron/cola en todo el backend**. Esto gobernó todas las decisiones de
alcance de esta fase — ver "Qué se simplificó deliberadamente" más abajo.

### Entidades nuevas

- **`ManagedClient`** (`domain/client/managed-client.entity.ts`): nombre, razón social, código
  interno, industria, estado (`ACTIVE/INACTIVE/SUSPENDED/ARCHIVED`), logo, fecha de inicio,
  supervisor, notas — siempre con `organizationId`, nunca mezclado entre organizaciones.
- **`ClientExecutiveAssignment`**: mismo shape PRIMARY/SECONDARY que `MailboxAssignment`
  (reutilizado por consistencia en vez de inventar `assignment_role`/`is_primary` como dos campos
  separados) — quién tiene acceso a qué cliente.
- **`Domain`** (carpeta `domain/domain-entity/` para no chocar con la carpeta arquitectónica
  `src/domain/`): nombre de dominio, cliente propietario, estado, notas. Único **por organización**,
  no globalmente — se evaluó explícitamente antes de decidirlo (ver el propio comentario en
  `domain.entity.ts`): las organizaciones ya están completamente aisladas en este código, no hay
  ningún escenario donde dos tenants deban compartir un dominio.
- **`Conversation` / `ConversationMessage` / `ConversationTag` / `ConversationNote`**
  (`domain/conversation/`): el modelo persistido que reemplaza la bandeja en vivo. `Conversation`
  guarda `emailThreadId` (el id de hilo que ya devolvía el motor) para sincronizar de forma
  idempotente; **no existe una entidad `Contact`/`Prospect`** en este código (confirmado por la
  auditoría — `SequencesService.getReadiness().prospects` siempre reportó `PENDING_FEATURE`), así
  que el remitente se guarda denormalizado (`contactEmail`/`contactName`) en vez de fabricar esa
  entidad solo para este pivote.
- **`Mailbox` gana `clientId`/`domainId`** (ambos nulables — "Pendiente de clasificación" es un
  estado temporal explícitamente permitido, nunca un cliente inventado en silencio).
  **`Sequence` gana `clientId`**, deducido automáticamente desde `mailboxId` en
  `SequencesService.update()` (nunca aceptado directo en un DTO público) — así los conteos y
  permisos por cliente no necesitan un join Mailbox→Domain→Client en cada consulta.

### El mecanismo de sincronización — por qué es "on-demand", no un worker

No hay ningún scheduler en este backend (confirmado por auditoría, ver arriba), así que construir
uno solo para este pivote habría sido inventar infraestructura nueva no pedida. En su lugar,
`ConversationsService.syncMailbox()` reutiliza exactamente el mismo punto de integración que ya
existía (`MailboxesService.getInbox`/`getThread`, es decir, el `EngineClient` — real o mock) pero
**materializa** el resultado en `Conversation`/`ConversationMessage` en vez de solo devolverlo. La
sincronización se dispara **al pedir la lista de conversaciones** (`GET /me/conversations`, o al
navegar a una cuenta desde la jerarquía Cliente→Dominio→Cuenta), no en segundo plano — documentado
así explícitamente, no disfrazado de tiempo real.

- **Clasificación**: `conversation-classifier.ts` es una función pura, determinística, basada en
  palabras clave normalizadas (sin acentos) sobre asunto+fragmento — nunca IA, tal como pide la
  especificación para el MVP ("priorizar reglas determinísticas"). Reconoce fuera-de-oficina,
  cancelación/baja, rebote, rechazo comercial, interés, y solicitud de información; cualquier cosa
  que no calce cae en `UNCLASSIFIED` en vez de adivinar.
- **Asociación a secuencia — simplificación explícita de la cadena de 8 pasos del pedido**: el
  motor mock no genera `Message-ID`/`In-Reply-To`/`References` reales (no hay bandeja real detrás),
  así que la única señal genuina disponible es "qué secuencia, si alguna, envía desde exactamente
  esta cuenta" (`Sequence.mailboxId`). `findCandidateSequence()` resuelve eso, y solo cuando es
  **inequívoco** (exactamente una secuencia `DRAFT`/`PAUSED` en esa cuenta) — cero o varias
  candidatas dejan la conversación sin asociar a una secuencia en vez de adivinar, tal como pide
  el §14 ("no asociar automáticamente cuando exista ambigüedad significativa").
- **Detención automática de secuencia**: cuando un mensaje nuevo se clasifica como respuesta
  humana (o rebote permanente/cancelación) y sí se asoció a una secuencia `DRAFT`, se llama al
  mismo `SequencesService.pause()` real que ya usa el botón manual de pausar — reutilizado, no
  duplicado — y se registra `sequence.auto_pause` en auditoría con la razón y la conversación que
  lo disparó. "Cancelar jobs programados" (§23) no tiene nada que cancelar porque no existe ningún
  scheduler que programe steps todavía; pausar la secuencia (que bloquea cualquier envío futuro por
  el flujo normal de creación/edición/prueba) es todo lo que "detener" significa en esta fase.

### Mensajes sin identificar

En vez de fabricar una cola paralela, "Mensajes sin identificar" (§25) es un filtro
(`unmatchedOnly`) sobre la misma tabla `Conversation`: conversaciones cuya cuenta de correo todavía
no tiene cliente/dominio ("Pendiente de clasificación") — la ambigüedad real y ya modelada, no un
concepto inventado aparte. `GET /unmatched-messages`, `POST /unmatched-messages/:id/associate` y
`.../ignore` reutilizan exactamente `ConversationsService.associateManually`/
`updateManagementStatus`.

### Endpoints nuevos

```http
GET    /clients                                   # clients.read.all
GET    /clients/:id                                # clients.read.all
PATCH  /clients/:id                                # clients.update
DELETE /clients/:id                                # clients.delete
GET    /clients/:id/assignees                      # clients.read.all
PUT    /clients/:id/assignees                       # clients.assign
GET    /me/clients                                  # clients.read.assigned
GET    /me/clients/:id                               # clients.read.assigned

GET    /clients/:clientId/domains                    # domains.read
POST   /clients/:clientId/domains                    # domains.create
GET    /domains/:id                                  # domains.read
PATCH  /domains/:id                                  # domains.update
DELETE /domains/:id                                  # domains.delete
GET    /me/clients/:clientId/domains                 # domains.read (self-service)
GET    /me/domains/:id                               # domains.read (self-service)

POST   /mailboxes/:id/link-domain                    # mailboxes.update
GET    /clients/:clientId/mailboxes                  # mailboxes.read.all
GET    /domains/:domainId/mailboxes                  # mailboxes.read.all
GET    /me/clients/:clientId/mailboxes                # mailboxes.read.assigned
GET    /me/domains/:domainId/mailboxes                # mailboxes.read.assigned

GET    /conversations                                 # conversations.read.all (+ filtros)
GET    /conversations/:id                             # conversations.read.all
PATCH  /conversations/:id/status                      # conversations.update
PATCH  /conversations/:id/classification              # conversations.update
PATCH  /conversations/:id/assignment                  # conversations.assign
POST   /conversations/:id/archive                     # conversations.archive
POST   /conversations/:id/reopen                      # conversations.resolve
POST   /conversations/:id/associate                   # unmatched_messages.associate
POST   /conversations/:id/tags | DELETE .../tags/:tagId  # conversations.update
GET/POST /conversations/:id/notes                     # conversation_notes.read/.create
GET/PATCH/DELETE /conversation-notes/:id               # conversation_notes.update/.delete
GET/POST /conversation-tags | PATCH/DELETE .../:id     # conversation_tags.*
GET/POST/... /unmatched-messages...                    # unmatched_messages.*
Todo lo anterior también existe bajo /me/... para autoservicio del ejecutivo, con el mismo
patrón "requireAccessibleConversation/requireAssignedClient" ya usado en fases previas.
```

### Permisos nuevos

`clients.read.all/.read.assigned/.update/.delete/.assign`,
`domains.create/.read/.update/.delete`, `conversations.read.all/.read.assigned/.update/.assign/
.resolve/.archive`, `conversation_tags.create/.read/.update/.delete`,
`conversation_notes.create/.read/.update/.delete`, `unmatched_messages.read/.associate`. El rol
`EXECUTIVE` recibe las variantes `.assigned`/self-service de cada familia (más `domains.read` y
`conversation_tags.create/.read` — las etiquetas son de la organización completa, no por cliente,
así que no tienen variante `.assigned`). `mailboxes.read.*`/`.update` se reutilizan sin duplicar
(ya cubrían exactamente lo que pedía la especificación).

### Qué se simplificó deliberadamente (y por qué)

- **Sin paridad Prisma/Postgres para las entidades nuevas**: solo repositorios en memoria. Este
  proyecto nunca ha ejecutado una migración contra una base real (confirmado en fases previas), así
  que priorizar una implementación en memoria completa y probada, en vez de siete pares de
  repositorios Prisma sin nadie que los ejecute, fue la decisión correcta dado el tamaño del resto
  del pivote. `PrismaMailboxRepository`/`PrismaSequenceRepository` siguen compilando (devuelven
  `clientId: null` explícitamente, documentado en el propio código) para no romper ese driver.
- **Sin CRUD de administrador en la interfaz** para crear/editar clientes y dominios — el backend
  completo existe (`POST /clients`, `POST /clients/:id/domains`, etc., todos probados por e2e),
  pero no se construyó el formulario. El flujo de validación obligatorio de esta fase nunca lo
  necesita (arranca con datos ya sembrados), y priorizar la navegación del ejecutivo + el Centro de
  conversaciones (el corazón real del pedido) sobre formularios de alta fue la decisión consciente
  dado el tamaño ya enorme de esta entrega.
- **"Asignar responsable" en el Centro de conversaciones es "Asignarme"**, no un selector con
  cualquier ejecutivo de la organización — no existe un endpoint de autoservicio para listar
  ejecutivos (el único `/users` existente requiere `users.read`, admin-only), y reasignar a
  cualquier persona encaja mejor como una acción de supervisor/admin (§20: "Un supervisor
  autorizado debe poder reasignarla") que como autoservicio del ejecutivo.
  "Detener secuencia" **manual** tampoco se construyó como botón — el mandatorio de esta fase solo
  pide _confirmar_ que una respuesta detuvo la secuencia automáticamente, lo cual sí es real y
  probado.
- **Fragmento ("snippet") del último mensaje** no viaja en `ConversationSummary` — se puede agregar
  luego sin cambios de arquitectura, quedó fuera para no seguir creciendo el modelo en esta pasada.
- **Nivel de acceso "por dominio" o "por cuenta específica"** (§21) no se implementó — solo el
  nivel "cliente completo" vía `ClientExecutiveAssignment`, más el ya existente por-cuenta vía
  `MailboxAssignment`. La arquitectura queda preparada para extender granularidad (mismo patrón de
  tabla de asignación ya usado tres veces en este proyecto), pero no se construyó sin que la
  especificación lo exigiera explícitamente para el MVP (que sí lo permite: "prioriza un modelo
  simple y mantenible").

### Navegación final

Sidebar: `Clientes` (nueva, primera) y `Centro de conversaciones` (nueva) se agregan;
`Ejecutivos`/`Cuentas de Correos`/`Secuencias`/`Variables`/`Auditoría` se conservan — "Cuentas de
Correos" sigue siendo necesaria para el alta/configuración IMAP-SMTP cruda, una preocupación
distinta de navegar la jerarquía Cliente→Dominio→Cuenta. Nunca existe una etiqueta "Bandeja de
entrada" en ningún menú. Rutas: `/dashboard/clients`, `/dashboard/clients/:clientId`,
`/dashboard/clients/:clientId/domains/:domainId`, `/dashboard/conversations` (con
`?clientId=&domainId=&mailboxId=&status=&conversationId=` para persistir la selección en la URL).

### Validado en vivo (Playwright, `chromium`) — flujo obligatorio de esta fase

```
Ingresar como ejecutivo → Clientes → Litoral Software (Demo) → mejoreferido-demo.test → Ventas (Demo)
→ Centro de conversaciones filtrado por esa cuenta (10 conversaciones sincronizadas) → abrir una
conversación → hilo completo en modo lectura (3 mensajes) → clasificar como "Interesado" →
crear y aplicar la etiqueta "Reunión agendada" → agregar nota interna → confirmar responsable
(heredado automáticamente del dueño de la secuencia) → marcar como resuelta → reabrir → confirmar
que Responder/Responder a todos/Reenviar/Crear borrador existen pero están deshabilitados →
confirmar en /dashboard/sequences/mine que la secuencia demo quedó "Pausada" tras la sincronización.
```

Build, lint, `format:check`, tests unitarios (271/271) y e2e (126/126, incluido un
`clients.e2e-spec.ts` nuevo con 7 casos cubriendo jerarquía, aislamiento multiempresa,
sincronización y la detención automática end-to-end) se ejecutaron en verde antes de esta prueba.

### Pendiente explícito (fuera de esta entrega)

- Paridad Prisma/Postgres para `ManagedClient`/`Domain`/`Conversation`/`ConversationMessage`/
  `ConversationTag`/`ConversationNote`.
- CRUD de administrador (crear/editar cliente, crear/editar dominio) en la interfaz — el backend ya
  existe y está probado.
- Asignación granular por dominio o por cuenta específica (hoy solo por cliente completo o, para
  bandeja/firma, por cuenta vía `MailboxAssignment`).
- Reasignación de una conversación a cualquier ejecutivo desde el autoservicio (hoy solo
  "asignarme"); un selector completo encaja mejor como función de supervisor/admin.
- Botón manual "Detener secuencia" desde una conversación (la detención automática sí es real).
- Fragmento del último mensaje en la lista de conversaciones.
- Todo lo que ya estaba pendiente de la Fase 10 (scheduler/worker real, `Contact`/`Prospect`,
  sincronización IMAP real, hilos MIME reales, adjuntos) — este pivote depende exactamente de las
  mismas piezas de infraestructura que aún no existen, y las mismas razones de no fabricarlas
  siguen aplicando aquí.

## Fase 10 — Secuencias de prospección: secuencia, steps, editor y firma automática

Pedido con alcance muy amplio (secuencias, prospectos/contactos, calendario de envío, scheduler,
detección de respuesta, hilos MIME). Igual que en la Fase 9, se acordó con el usuario un recorte
explícito antes de escribir código: esta entrega cubre **Secuencia + Steps + editor + firma
automática + perfil de ejecutivo**; el resto (contactos/import, calendario real, scheduler/worker,
sincronización IMAP/detección de respuesta, hilos MIME) queda pendiente de diseño como fases
propias — ver "Pendiente explícito" abajo.

- **`Sequence` y `SequenceStep`, entidades nuevas**: una secuencia pertenece a un ejecutivo
  (`executiveId`) y opcionalmente a una cuenta remitente (`mailboxId`, null hasta que se elige).
  `SequenceStatus` es deliberadamente solo `DRAFT | PAUSED | ARCHIVED` — no existe `ACTIVE` ni
  `READY`/`COMPLETED`/`ERROR` todavía, porque activar una secuencia sería pura teatralidad sin un
  scheduler/worker real que la consuma (no construido en esta fase). Pausar/reanudar/archivar/
  restaurar es la máquina de estados completa por ahora.
- **Selección de cuenta remitente restringida**: `SequencesService` reutiliza
  `MailboxAssignmentRepository.findByMailbox` para exigir que la cuenta elegida esté asignada al
  ejecutivo dueño de la secuencia — nunca se agregó un endpoint nuevo para eso, solo se extendió
  `MailboxesService.list(organizationId, executiveId?)` (y `GET /mailboxes?executiveId=`) para que
  el selector del formulario solo ofrezca cuentas asignadas a ese ejecutivo.
- **Editor de step reutilizando por completo el editor de Fase 9**: los componentes Tiptap
  (editor, toolbar, extensión de tamaño de fuente, botón de subida de imagen, menú de variables)
  vivían junto a la firma bajo la ruta dinámica de edición de `Mailbox`. Se extrajeron a
  `apps/web/components/rich-text-editor/` como un `RichTextEditor` genérico parametrizado por
  `variables`/`placeholder` — la firma y el step ahora son dos consumidores delgados del mismo
  componente en vez de dos copias del mismo código.
- **La firma nunca se selecciona dentro de un step — se compone automáticamente**: los DTOs de
  step (`CreateSequenceStepDto`/`UpdateSequenceStepDto`) deliberadamente no tienen ningún campo
  `signatureId`/`signatureMode`/`includeSignature` — el `ValidationPipe({forbidNonWhitelisted:
true})` global rechaza con `400` cualquier intento de enviarlos (verificado con un e2e propio).
  La firma se resuelve en caliente, solo al previsualizar o enviar una prueba, siguiendo
  `Sequence.mailboxId → Signature.findByMailbox → activeVersionId → SignatureVersion`, y se
  concatena al HTML/texto plano del step con un separador fijo — nunca se guarda ni se cachea.
- **Versionado de contenido, no de estado**: cada `PATCH` que cambia contenido real (asunto,
  cuerpo, delay, modo de envío) crea una `SequenceStepVersion` inmutable; un `PATCH` que solo
  cambia `status` no crea versión nueva. Esto expuso un bug real durante el desarrollo (ver
  "Aprendizajes" más abajo) que quedó corregido y cubierto por un test antes de cerrar la fase.
- **Variables `{{contact.*}}`**: siempre resuelven a un mapa de ejemplo genérico
  (`GENERIC_CONTACT_SAMPLES` en `sequence-variable-resolver.ts`, `isReal: false`) — no existe
  todavía una entidad `Contact`. `{{sender.*}}`/`{{mailbox.*}}` reutilizan exactamente la
  resolución de datos reales ya construida en la Fase 9.
- **Reordenar/duplicar/eliminar steps**: `position` se mantiene contiguo (1..N) dentro de una
  secuencia; reordenar, eliminar y duplicar renormalizan las posiciones como una serie de
  `update()` secuenciales en el servicio (no hay todavía una transacción real de Postgres que
  envolver, porque este proyecto nunca ha migrado contra una base real).
- **Revisión de disponibilidad (readiness) parcial y honesta**: `GET /sequences/:id/readiness`
  solo puede validar lo que existe hoy — cuenta remitente operativa con firma activa, y que cada
  step tenga asunto/contenido. Prospectos y calendario se reportan como
  `{ status: 'PENDING_FEATURE' }`, nunca como si pasaran o fallaran una validación que no puede
  hacerse todavía.
- **Perfil de ejecutivo con pestañas** (`/dashboard/executives/[id]`): Resumen, Cuentas asignadas,
  Secuencias, Actividad, Permisos. Las dos últimas necesitaron endpoints nuevos y mínimos:
  `GET /roles/:id/permissions` (reexpone `RoleRepository.getPermissionKeys`, ya existía para
  autorización) y `GET /users/:userId/audit-log` (nuevo `AuditModule`, extiende
  `AuditLogRepository.findAll` con un filtro opcional `actorId`). Es una pantalla distinta del
  ítem "Auditoría" del menú lateral (que sigue en construcción, ver más arriba): esta es un log
  acotado a un usuario, no un log global de la organización.
- **Envío de prueba de step**: reutiliza `EngineClient.sendMail()` de la Fase 9 sin cambios —
  se registra como `TEST_EMAIL`, nunca se afirma entrega definitiva, solo que SMTP aceptó el
  mensaje.

### Endpoints nuevos de esta fase

```http
GET    /users/:userId/sequences               # sequences.read
POST   /users/:userId/sequences               # sequences.create
GET    /sequences/:id                         # sequences.read
PATCH  /sequences/:id                         # sequences.update
POST   /sequences/:id/duplicate               # sequences.create
POST   /sequences/:id/pause                   # sequences.pause   — solo DRAFT → PAUSED
POST   /sequences/:id/resume                  # sequences.pause   — solo PAUSED → DRAFT
POST   /sequences/:id/archive                 # sequences.archive
POST   /sequences/:id/restore                 # sequences.archive — solo ARCHIVED → DRAFT
GET    /sequences/:id/readiness               # sequences.read
GET    /sequences/:id/steps                   # sequence_steps.read
POST   /sequences/:id/steps                   # sequence_steps.create
PUT    /sequences/:id/steps/reorder           # sequence_steps.update
GET    /sequence-steps/:stepId                # sequence_steps.read
PATCH  /sequence-steps/:stepId                # sequence_steps.update
DELETE /sequence-steps/:stepId                # sequence_steps.delete
POST   /sequence-steps/:stepId/duplicate      # sequence_steps.create
GET    /sequence-steps/:stepId/versions       # sequence_steps.read
GET    /sequence-steps/:stepId/preview        # sequence_steps.read
POST   /sequence-steps/:stepId/send-test      # sequence_steps.test
GET    /roles/:id/permissions                 # roles.read
GET    /users/:userId/audit-log               # audit.read
```

`GET /mailboxes` (existente desde la Fase 2) ganó un query param opcional `?executiveId=` —
retrocompatible, si se omite se comporta exactamente igual que antes.

### Aprendizajes / bug real encontrado durante el desarrollo

`apps/api/tsconfig.json` usa `target: ES2022`, que hace que TypeScript active
`useDefineForClassFields` por defecto — cada campo declarado de una clase DTO se vuelve una
propiedad propia (`undefined` si no se envió) en cualquier instancia creada por el
`ValidationPipe({transform: true})` global de NestJS. Esto rompe el idiom `campo in objeto` para
detectar "¿se envió este campo?": siempre da `true`. Un test propio (
"no crea una versión nueva por un cambio de solo estado") lo detectó: un `PATCH {status:
'PUBLISHED'}` estaba creando una versión 3 idéntica a la 2. Se corrigió cambiando a
`objeto[campo] !== undefined` en `sequence-steps.service.ts`, y se confirmó que era el único lugar
del código con ese patrón.

### Limitación conocida: "Actividad" está acotada por actor, no por dueño del recurso

`GET /users/:userId/audit-log` filtra por **quién ejecutó** la acción (`actorId`), no por a quién
pertenece el recurso afectado. Si un administrador crea o edita la secuencia de un ejecutivo (el
flujo normal, ya que `sequences.*`/`sequence_steps.*` son permisos exclusivos de administrador en
esta fase), esas entradas de auditoría quedan bajo el `actorId` del administrador — la pestaña
"Actividad" del perfil del ejecutivo no las mostrará, aunque el recurso sea suyo. Se descubrió
escribiendo el e2e de auditoría de esta fase y se confirmó de nuevo en la prueba de humo en vivo
(la pestaña muestra correctamente su estado vacío documentado en ese escenario). Corregirlo
requeriría decidir un modelo distinto (¿mostrar acciones sobre los recursos del usuario,
independientemente de quién las ejecutó?) que no se acordó con el usuario en esta fase.

### Ajuste post-entrega: navegación anidada bajo el perfil del ejecutivo + bandeja de demostración

Tras la entrega inicial de esta fase, el usuario pidió dos cambios puntuales, ambos ya
implementados y validados:

- **Crear/ver secuencias y steps ahora vive completamente anidado bajo el perfil del ejecutivo.**
  Las rutas pasaron de ser planas (`/dashboard/sequences/:id`) a
  `/dashboard/executives/:executiveId/sequences/:sequenceId` (y sus steps,
  `.../sequences/:sequenceId/steps/:stepId`) — cada página valida que la secuencia/step
  efectivamente pertenezca al ejecutivo de la URL (`404` si no), y todo enlace "Volver" regresa
  dentro de ese mismo árbol, nunca a una lista de secuencias suelta.
- **Bandeja de entrada por cuenta asignada, con la misma disciplina de puertos y adaptadores que
  el resto del proyecto.** El repositorio nunca conecta directo a un servidor de correo — el motor
  real (IMAP/SMTP/scheduler) es un componente aparte (ver el primer párrafo de este README) — así
  que leer una bandeja se resolvió igual que probar una conexión o enviar un correo de prueba:
  agregando `fetchInbox`/`fetchThread` al puerto `EngineClient`. `MockEngineClient` genera un
  conjunto fijo (no aleatorio) de conversaciones de ejemplo por cuenta, reutilizando la misma
  convención "+tag" que ya existía para forzar escenarios de error
  (`cuenta+motorcaido@dominio.com` → bandeja no disponible); `HttpEngineClient` ya tiene el
  passthrough listo (`POST /mailboxes/inbox`, `POST /mailboxes/inbox/thread`) para cuando el motor
  real lo implemente. Nada se persiste — cada carga de bandeja es una lectura directa al motor,
  igual que una prueba de conexión. Se accede desde la pestaña "Cuentas asignadas" del perfil del
  ejecutivo (`/dashboard/executives/:id/mailboxes/:mailboxId/inbox`), con una vista de dos columnas
  (lista de hilos + detalle del hilo seleccionado) similar a la de Saleshandy.

### Segundo ajuste post-entrega: autoservicio real para el ejecutivo (no solo el admin viéndolo por él)

El usuario aclaró que lo anterior no era suficiente: **el propio ejecutivo**, con su propia sesión,
debe poder ver la bandeja de sus cuentas asignadas y crear/editar sus propias secuencias y steps
— no solo el admin haciéndolo por él desde el perfil del ejecutivo (esa vista admin se mantiene
intacta, como una segunda forma de llegar a lo mismo).

- **Dos permisos nuevos, de alcance acotado a uno mismo**: `sequences.manage.own` y
  `sequence_steps.manage.own`, otorgados al rol `EXECUTIVE` (no reemplazan
  `sequences.create/read/update/...`, que siguen siendo exclusivos del admin para gestionar
  secuencias de cualquier ejecutivo). Un solo permiso cubre crear/leer/editar/pausar/archivar/
  duplicar — no hay una matriz separada de sub-permisos para el autoservicio, a diferencia del
  lado admin.
- **Endpoints `/me/sequences`, `/me/sequences/:id/steps`, `/me/sequence-steps/:stepId` nuevos**,
  reutilizando `SequencesService`/`SequenceStepsService` sin cambiar su lógica de negocio — solo se
  agregó `requireOwnedByExecutive(organizationId, id, executiveId)` a cada servicio, que hace lo
  mismo que la comprobación de organización ya existente pero además exige que
  `sequence.executiveId === executiveId`. Nunca se confía en un `userId` de la URL: el ejecutivo
  autenticado siempre actúa sobre sí mismo (`user.id` del JWT), igual que ya hacía `GET
/me/mailboxes`.
- **`GET /me/mailboxes/:id/inbox`**: incluso teniendo el ejecutivo un permiso amplio de lectura de
  bandeja, la cuenta debe estar realmente asignada a él — se verifica contra
  `MailboxAssignmentRepository`, igual que el resto del sistema de asignaciones, antes de llamar al
  motor.
- **Un colega nunca puede confirmar que un id ajeno existe**: todo intento de acceder a una
  secuencia, step o bandeja que no es propia responde `404`, nunca `403` — la misma regla que
  gobierna el resto de esta API, verificada con e2e dedicados (`me-sequences.e2e-spec.ts`).
- **Cero componentes de UI duplicados**: el formulario de información general, las acciones de
  estado, la lista de steps, el editor de step, la vista previa, el envío de prueba y la bandeja de
  entrada se extrajeron de la ruta admin (`app/dashboard/executives/...`) a
  `apps/web/components/sequences/` y `apps/web/components/inbox/` — cada componente recibe un
  prop opcional `mine` que cambia únicamente la ruta de API que llama (`/api/sequences/...` vs
  `/api/me/sequences/...`); la vista admin y la del ejecutivo son dos árboles de rutas delgados
  sobre el mismo código.
- **Nueva entrada "Secuencias" en el menú lateral** (`/dashboard/sequences/mine`), visible con
  `sequences.manage.own` — y una nueva columna "Bandeja" en "Mis cuentas de correo"
  (`/dashboard/mailboxes/mine/:id/inbox`), junto a "Ver firma".

### Tercer ajuste post-entrega: bandeja de dos paneles, configuración centralizada de cuenta, eliminación de secuencias y explicaciones de step

El usuario pidió una revisión de interfaz y comportamiento sobre siete áreas ya existentes
(bandeja, cuentas asignadas, firmas, secuencias, steps, menús de acciones de cuenta), con la
instrucción explícita de **reutilizar lo existente y no reconstruir módulos que ya funcionan**.
Antes de tocar código se auditó (agente de exploración) el estado real de rutas, componentes,
permisos, endpoints y relaciones de esas siete áreas — varias piezas del pedido ya existían
(bandeja de dos columnas, editor de firma, borrado de sequence steps) y solo había que extenderlas
o corregirlas, no crearlas de nuevo.

- **Bandeja con panel de lectura fijo a la derecha** (`apps/web/components/inbox/inbox-view.tsx`):
  la lista de hilos nunca desaparece — seleccionar un hilo solo actualiza el panel derecho.
  Estado vacío antes de seleccionar ("Selecciona una conversación / El contenido del correo
  aparecerá en este panel."), hilo activo distinguido visualmente (`aria-current`), toggle
  HTML/texto plano, y el hilo seleccionado se sincroniza a la URL (`?thread=<id>`) vía
  `router.replace(..., {scroll:false})` para poder recuperarse al recargar la página — confirmado
  con la prueba de humo (seleccionar, recargar, la misma conversación sigue abierta). En móvil la
  lista ocupa toda la pantalla; seleccionar un hilo abre el panel de lectura a pantalla completa
  con un botón "Volver" que oculta el panel y muestra la lista de nuevo (mismo componente, sin
  duplicar código por breakpoint). De las ocho acciones pedidas en el panel de lectura, solo
  "Marcar leído/no leído" tiene datos reales que mover (nuevo `EngineClient.setThreadReadState` +
  `MockEngineClient` con un `Map` de overrides en memoria); Responder, Responder a todos, Archivar,
  Agregar etiquetas, Cambiar estado del prospecto y Detener secuencia se muestran como botones
  visibles pero deshabilitados (`title="Disponible en una fase futura"`) — no hay pipeline de envío
  de respuesta, ni entidades de etiqueta/prospecto/campaña todavía, y esta fase no fabrica un
  comportamiento falso para ellas. Igual con Campaña/secuencia relacionada, Prospecto relacionado y
  Adjuntos: se muestran como placeholders "no disponible en esta fase" en vez de omitirse, para
  dejar visible la estructura que el pedido describe.
- **Botón "Ver bandeja" corregido y centralizado**: la bandeja ya existía desde el primer ajuste
  post-entrega de la Fase 10 (`/dashboard/executives/:id/mailboxes/:mailboxId/inbox` y
  `/dashboard/mailboxes/mine/:id/inbox`, ambas ya identificadas por `mailboxId`, nunca por email) —
  no se creó una ruta nueva. Lo que sí se corrigió es que cada tabla de cuentas construía su propio
  enlace "Ver bandeja"/"Ver firma" a mano, con riesgo de repetir o desalinear el `mailboxId`. Se
  creó `apps/web/lib/mailbox-actions.ts` (`getMailboxActions(scope)` → lista tipada de
  `{key, label, icon, href}`) y `apps/web/components/mailboxes/mailbox-action-buttons.tsx`, y todas
  las tablas de cuentas (perfil del ejecutivo, "Mis cuentas de correo") ahora renderizan esa misma
  configuración en vez de enlaces sueltos.
- **"Ver firma" reemplazado por un botón de configuración**: el enlace de texto "Ver firma"
  desapareció; en su lugar cada fila de cuenta muestra un botón con el ícono `Settings` de
  `lucide-react` (`aria-label="Configurar cuenta de correo"`, `title="Configurar cuenta"`), parte
  de la misma configuración centralizada de arriba.
- **Panel de configuración de cuenta — alcance recortado deliberadamente**: para el admin, el
  engranaje abre la página ya existente `/dashboard/mailboxes/:id/edit` (General + Firma +
  Asignaciones + historial de conexión, ya construida en fases previas) en vez de reconstruirla con
  pestañas nuevas — la especificación permite explícitamente "una única página con pestañas...si es
  más coherente con el proyecto", y esa página ya cumple ese rol. **No se construyeron** las
  secciones "Límites de envío", "Sincronización" ni "Estado y diagnóstico" que sugiere la
  especificación: no existe todavía un modelo de datos de límites/throttling ni un worker de
  sincronización real detrás de qué mostrar — habría sido una interfaz decorativa sin datos reales,
  contrario a la disciplina de este proyecto de no fabricar comportamiento. Para el ejecutivo se
  creó una página nueva y acotada, `/dashboard/mailboxes/mine/:id/settings?tab=general|signature`
  (pestañas por query param, sin JS de cliente): "General" es de solo lectura (nombre, email,
  remitente, Reply-To, estado); "Firma" reutiliza el mismo `SignatureSection` que ya existía,
  parametrizado por `mine`.
- **Firma editable desde el perfil del ejecutivo, con autorización real en el backend** (no solo
  ocultando el botón en el frontend, como pedía explícitamente el usuario): `SignaturesService`
  ganó `getByMailboxForExecutive`/`saveForExecutive`/`previewForExecutive`/`sendTestForExecutive`,
  cada uno validando primero `requireAssignedMailbox(userId, mailboxId)` contra
  `MailboxAssignmentRepository` antes de delegar en la lógica ya existente — igual patrón que
  `/me/sequences` del segundo ajuste. Nuevo controlador `MeSignatureController`
  (`/me/mailboxes/:mailboxId/signature`, `GET`/`PATCH`/`GET preview`/`POST send-test`), y el
  permiso `signatures.update` se otorgó al rol `EXECUTIVE` (antes exclusivo de administrador). Una
  cuenta no asignada responde `404`, nunca `403` — mismo criterio multi-tenant que rige el resto de
  la API. La firma sigue perteneciendo a la cuenta de correo, nunca al ejecutivo: guardar solo crea
  una nueva `SignatureVersion` sobre el mismo `Signature.mailboxId`, exactamente igual que cuando
  edita un administrador.
- **Eliminar secuencias desde el perfil del ejecutivo, con confirmación por texto**: nuevo
  `DeleteSequenceButton` (`apps/web/components/sequences/delete-sequence-button.tsx`) — diálogo
  modal con la copia exacta pedida, botón "Eliminar secuencia" deshabilitado hasta escribir
  `ELIMINAR` literal. Reutilizable como botón (página de detalle) o enlace compacto (fila de
  tabla) — aparece en ambos lugares. Backend: se confirmó leyendo el código que `Sequence.deletedAt`
  ya existía en la entidad y ya se filtraba en ambos repositorios (`InMemory`/`Prisma`); lo único
  que faltaba era **escribirlo**. `SequencesService.remove()` hace `update(id, {status: 'ARCHIVED',
deletedAt: now})` reutilizando el método `update()` genérico existente (sin tocar ningún
  repositorio) y registra `sequence.delete` en auditoría con `previousStatus` y `cancelledJobs` (0
  — no hay todavía scheduler/worker cuyos jobs cancelar; el campo existe en la respuesta para
  cuando lo haya). Nunca se borra físicamente nada: mensajes enviados, respuestas, rebotes, eventos
  SMTP, snapshots y auditoría se conservan siempre — verificado con e2e dedicados y con la prueba
  de humo (crear secuencia → agregar step → eliminar → el log de auditoría del ejecutivo conserva
  `sequence.create`, `sequence_step.create` y `sequence.delete` los tres). Nuevo permiso
  `sequences.delete` (admin, `DELETE /sequences/:id`) y reutilización de `sequences.manage.own`
  para el ejecutivo (`DELETE /me/sequences/:id`, con el mismo `requireOwnedByExecutive` ya
  existente). Idempotente: un segundo `DELETE` sobre una secuencia ya eliminada devuelve `404`
  (el filtro por `deletedAt` en los repositorios la hace invisible), sin lanzar un error distinto.
- **Explicaciones breves en la creación/edición de un step**: los campos Esperar, Unidad y Envío
  (`create-step-form.tsx`, `step-editor-form.tsx`) ganaron texto auxiliar visible bajo cada campo
  (no oculto solo en un tooltip, con `aria-describedby` enlazando el campo a su explicación) con la
  copia exacta pedida, incluida la variante de Esperar para el primer step de la secuencia y la
  variante de Envío según se elija "Correo nuevo" o "Respuesta en el mismo hilo".
- **Auditoría ampliada**: `signature.update` (ya existente) ahora también se registra cuando quien
  edita es un ejecutivo actuando sobre una cuenta asignada, no solo un administrador; `sequence.delete`
  es un evento nuevo con `previousStatus`/`cancelledJobs` en sus metadatos. Ningún evento nuevo
  registra credenciales ni contenido sensible innecesario.

#### Endpoints nuevos de este ajuste

```http
DELETE /sequences/:id                                        # sequences.delete (admin)
DELETE /me/sequences/:id                                      # sequences.manage.own (ejecutivo, con ownership)
GET    /me/mailboxes/:mailboxId/signature                     # signatures.read
PATCH  /me/mailboxes/:mailboxId/signature                     # signatures.update
GET    /me/mailboxes/:mailboxId/signature/preview             # signatures.preview
POST   /me/mailboxes/:mailboxId/signature/send-test           # signatures.test
POST   /mailboxes/:id/inbox/threads/:threadId/read-state      # mailboxes.read.all (admin)
POST   /me/mailboxes/:id/inbox/threads/:threadId/read-state   # mailboxes.read.assigned (ejecutivo)
```

Todos son extensiones del mismo patrón `/me/...` ya establecido en el segundo ajuste — ningún
endpoint admin existente cambió de contrato ni de comportamiento.

#### Bug real encontrado y corregido: `tailwind.config.ts` no escaneaba `components/` ni `lib/`

El `content` de Tailwind solo incluía `./app/**/*.{ts,tsx}` y el paquete `packages/ui` — nunca
`./components/**` ni `./lib/**`. Como el nuevo `inbox-view.tsx` vive bajo `apps/web/components/`,
sus clases `hidden`/`md:block` (usadas ahí y en ningún archivo de `app/**`) nunca se generaban en
el CSS compilado: el panel de lista quedaba en `display:none` sin importar el ancho de pantalla,
sin ningún error de build que lo señalara. Era un bug latente desde la extracción de componentes
del segundo ajuste — no se detectó antes porque, por coincidencia, las clases de esos componentes
anteriores también aparecían textualmente en algún archivo de `app/**`. Se corrigió agregando
`'./components/**/*.{ts,tsx}'` y `'./lib/**/*.{ts,tsx}'` al arreglo `content`.

#### Validado en vivo — flujo completo obligatorio (Playwright, `chromium`)

```
Login admin → abrir ejecutivo → cuentas asignadas → abrir bandeja → seleccionar conversación
→ leerla en el panel derecho → confirmar que ?thread= persiste tras recargar → volver a cuentas
asignadas → abrir configuración (engranaje) → [cambio de sesión a la del propio ejecutivo] →
configuración de autoservicio → pestaña Firma → editar y guardar → secuencias propias → crear
un step revisando sus tres explicaciones (incluida la variante "Respuesta en el mismo hilo") →
eliminar una secuencia propia con el diálogo de confirmación por texto → confirmar en el log de
auditoría del ejecutivo (sesión admin) que sequence.create, sequence_step.create y sequence.delete
conviven, y que la secuencia eliminada ya no aparece en el listado.
```

Build (`npm run build`), lint, `format:check`, tests unitarios y e2e del backend se ejecutaron en
verde antes de esta prueba de humo (ver "Pruebas" más abajo para los números).

### Cuarto ajuste post-entrega: bandeja estilo Outlook Desktop (tres columnas), tarjetas de cuenta simplificadas y "Firmas" fuera del menú lateral

El usuario pidió una experiencia tipo Outlook Desktop: **Cuentas → Mensajes de la cuenta
seleccionada → Hilo del mensaje seleccionado**, en tres columnas simultáneas, reemplazando la
tabla plana de "Mis cuentas de correo" y sus botones por tarjetas de cuenta compactas y
completamente seleccionables. Se auditó primero el estado real de rutas/componentes/endpoints
(bandeja de dos columnas, `/me/mailboxes`, permisos de firma y asignaciones) antes de escribir
código, siguiendo la misma instrucción explícita de no reconstruir lo que ya funcionaba.

- **`MailWorkspace` (nuevo, `apps/web/components/inbox/mail-workspace.tsx`)** reemplaza la tabla de
  `/dashboard/mailboxes/mine` por un layout de tres columnas (Cuentas · Mensajes · Panel de
  lectura). No es una página nueva ni una ruta duplicada: es el mismo `/dashboard/mailboxes/mine`
  de siempre, ahora sincronizado con `?mailboxId=&threadId=` en la URL (recuperable al recargar,
  validado contra `/me/mailboxes` en el servidor — un `mailboxId` ajeno nunca se acepta, cae al
  estado vacío "Selecciona una cuenta"). Selecciona una cuenta → limpia el hilo seleccionado, carga
  sus mensajes, actualiza el encabezado de la columna central; selecciona un mensaje → lo resalta,
  lo marca como leído (reutilizando `setThreadReadState`, ya existente), carga el hilo en la
  columna derecha, mantiene visible el listado. Reutiliza sin duplicar: `ThreadListItem` y el
  panel de lectura completo se extrajeron de `InboxView` (ver más abajo) en vez de reescribirse.
- **Extracción de `ThreadReadingPanel`** (`inbox-view.tsx`): el bloque de asunto/participantes/
  acciones/mensajes que antes vivía inline dentro de `InboxView` ahora es un componente
  independiente y exportado, parametrizado (`onBack`, `backLabel`, `emptyDescription`,
  `mailboxEmail` opcional). `InboxView` (la bandeja de dos columnas que sigue usando el admin desde
  el perfil del ejecutivo, sin cambios de comportamiento) y `MailWorkspace` consumen exactamente el
  mismo componente — cero duplicación de la lógica de acciones/sanitización/adjuntos-pendientes.
- **Tarjetas de cuenta simplificadas y sin botones**: cada cuenta en la columna izquierda muestra
  solo nombre, correo, estado operativo y estado de conexión (con un punto de color) — nada de
  firma, límites, IMAP/SMTP, credenciales ni acciones individuales. Toda la tarjeta es un
  `<button role="option" aria-selected>` dentro de un `role="listbox"`: foco de teclado nativo
  (Tab/Enter funcionan sin JavaScript adicional), anillo de foco visible, fondo e indicador lateral
  cuando está seleccionada. "Ver bandeja" y "Configuración" **ya no existen** como botones en esta
  vista — el contador de mensajes no leídos por cuenta se dejó fuera deliberadamente: no existe hoy
  como campo agregado en `AssignedMailboxSummary` (solo por hilo), y la especificación lo condiciona
  a "si ya existe esa información".
- **El engranaje se movió al contexto de la cuenta seleccionada**: vive en el encabezado de la
  columna central (junto al nombre de la cuenta), con `aria-label="Configurar cuenta de correo"` y
  `title="Configurar cuenta"` — nunca en la tarjeta. Abre siempre `/dashboard/mailboxes/mine/:id/
settings` de la cuenta activa, nunca otra.
- **Configuración de cuenta ampliada a las 7 secciones pedidas** (`General · Conexión · Firma ·
Asignaciones · Límites de envío · Sincronización · Estado y diagnóstico`), tanto para el
  ejecutivo (`/dashboard/mailboxes/mine/:id/settings?tab=...`) como para el admin (mismo
  `/dashboard/mailboxes/:id/edit` de siempre, ahora con encabezados de sección en vez de bloques
  sueltos — se mantiene como página única sin pestañas, tal como se decidió en el ajuste anterior).
  De estas 7, **Conexión y Asignaciones son reales** para el ejecutivo: `AssignedMailboxSummary`
  ganó `lastTestedAt`/`lastTestMessage` (ya existían en `Mailbox`, solo faltaba exponerlos), y se
  agregó `GET /me/mailboxes/:id/assignees` — de solo lectura, sin `PUT` equivalente, para que el
  ejecutivo pueda ver quién más es responsable de la cuenta sin poder reasignarla. **Límites de
  envío y Sincronización son placeholders explícitos** ("no disponible en esta fase") — no existe
  ningún campo de límite diario/intervalo/horario en `Mailbox`, ni un worker de sincronización IMAP
  real; fabricar esa UI sin datos reales habría sido pura teatralidad. **Estado y diagnóstico** es
  un resumen de mejor esfuerzo armado solo con datos que sí existen (estado operativo, estado de
  conexión, si hay firma activa, cantidad de asignados, último error) — capacidad disponible queda
  como pendiente porque depende del límite de envío que no existe todavía.
- **"Firmas" fuera del menú lateral** (`apps/web/lib/admin-navigation.ts`): se quitó la entrada
  independiente, dejando `Ejecutivos · Cuentas de Correos · Secuencias · Variables · Auditoría`.
  La especificación mostraba un menú final sin "Secuencias" también, pero esa omisión contradice el
  resto del propio pedido (la última sección de esta entrega pide explícitamente "Volver a
  Secuencias" como parte del flujo de validación) — se interpretó como un descuido de la lista
  ilustrativa y **se conservó "Secuencias"**, decisión que quedó documentada aquí en vez de
  asumirse en silencio. La ruta `/dashboard/signatures`, su controlador, sus endpoints y sus
  permisos siguen intactos — solo se desvinculó del menú; se accede a la firma de una cuenta desde
  su propio engranaje → pestaña Firma, igual que antes.
- **Ruta antigua de bandeja individual convertida en redirect**: `/dashboard/mailboxes/mine/:id/
inbox` (la bandeja de dos columnas previa a este ajuste) ya no se usa desde ningún enlace interno,
  pero en vez de eliminarla redirige a `/dashboard/mailboxes/mine?mailboxId=:id` — cualquier enlace
  viejo guardado sigue funcionando.
- **Steps: campo Estado explicado, con ejemplo desplegable compartido**: se extrajo
  `apps/web/components/sequences/step-field-help.tsx` (nuevo) con los textos de ayuda de
  Esperar/Unidad/Envío/Estado y el bloque `<details>` "Ver ejemplo de configuración" (la secuencia
  de 3 steps completa del pedido), reutilizado por `create-step-form.tsx` y `step-editor-form.tsx`
  en vez de duplicar la copia dos veces. La etiqueta visible del estado `PUBLISHED` pasó de
  "Publicado" a **"Activo"** (pedido explícito de la especificación) sin tocar el valor técnico
  subyacente — sigue siendo el mismo enum `SequenceStepStatus` de la Fase 10, que ya existía con
  las cuatro fases `DRAFT/PUBLISHED/DISABLED/ARCHIVED` desde antes de este ajuste. El formulario de
  creación (donde el step siempre nace en `DRAFT`) muestra el estado inicial como texto informativo
  no editable; el formulario de edición ya tenía un selector de estado — solo ganó
  `aria-describedby` y el texto de ayuda dinámico según el valor elegido. **No se construyó** la
  regla de negocio "omitir step desactivado y continuar con el siguiente activo, cancelando
  programaciones futuras": no existe ningún scheduler/worker que programe steps todavía (ver
  pendientes de Fase 10 más abajo), por lo que no hay nada que cancelar — el campo y su explicación
  son reales, la ejecución automática que reaccionaría a él no.
- **Auditoría de lectura de hilos**: `setThreadReadState`/`setThreadReadStateForExecutive` ahora
  registran `mailbox.thread.read-state` (con `threadId`/`isUnread` en los metadatos) — antes leía y
  escribía el estado sin dejar rastro en el log de auditoría.

#### Endpoints nuevos de este ajuste

```http
GET /me/mailboxes/:id/assignees   # mailboxes.read.assigned — solo lectura, sin PUT equivalente
```

Todo lo demás (mensajes, hilos, marcar leído/no leído, firma) reutiliza endpoints `/me/mailboxes/…`
que ya existían desde el segundo y tercer ajuste — no se creó ningún endpoint redundante.

#### Validado en vivo (Playwright, `chromium`) — flujo obligatorio de esta entrega

```
Login como ejecutivo → Mis cuentas de correo (sin botones "Ver bandeja"/"Configuración" en las
tarjetas) → seleccionar una cuenta (aria-selected="true", mensajes cargados) → seleccionar un
mensaje (hilo abierto en el panel derecho) → abrir el engranaje de la cuenta seleccionada →
pestaña Firma (editor visible) → confirmar que "Firmas" no aparece en el menú lateral → volver a
Secuencias → crear un step revisando Esperar/Unidad/Envío/Estado y el ejemplo desplegable →
cambiar Estado a Activo → guardar → confirmar que persiste tras refrescar.
```

Además se verificó por separado: la ruta vieja `/mine/:id/inbox` redirige correctamente; en móvil
(390px) el flujo es progresivo (Cuentas → Mensajes, con retorno); en tablet (820px) el hilo
reemplaza la columna de mensajes con un botón "Volver a mensajes" que la restaura; en escritorio
(1440px) las tres columnas están visibles a la vez; y del lado admin, la pestaña "Cuentas
asignadas" del perfil del ejecutivo conserva sus botones "Ver bandeja"/"Configurar" sin cambios
(este ajuste solo tocó la vista de autoservicio del ejecutivo, no la del admin sobre otro usuario).

Build, lint, `format:check`, tests unitarios (263/263) y e2e (119/119) del backend se ejecutaron en
verde antes de la prueba de humo.

### Pendiente explícito (fuera de esta entrega)

- **`Contact`/`ContactList` e importación CSV/Excel** — sin esto, `{{contact.*}}` seguirá
  resolviendo solo a datos de ejemplo genéricos.
- **Calendario de envío real (`SequenceSchedule`)** — días/horas permitidas, zona horaria efectiva
  de envío. Hoy `Sequence.timezone` se guarda pero no se aplica a ninguna ventana de envío real.
- **Scheduler/worker** que efectivamente consuma una secuencia — es la pieza que le daría sentido
  a un estado `ACTIVE`/`READY`/`COMPLETED`/`ERROR`, deliberadamente no agregado sin él.
- **Sincronización IMAP real y detección de respuesta** — la bandeja descrita arriba muestra datos
  de demostración generados por `MockEngineClient`, no correos reales; sin una sincronización real
  no puede existir "detener steps siguientes por respuesta/rebote/baja", pedido explícitamente en
  el flujo de validación del usuario pero fuera del alcance acordado para esta fase.
- **Hilos MIME reales** (`In-Reply-To`/`References`) para `StepSendMode.REPLY` — hoy el campo
  existe en el modelo y se puede elegir en el editor, pero no hay envío real que lo use.
- **Adjuntos (`StepAttachment`)** — no implementado.
- **El wizard guiado de 9 etapas** de la especificación original — se entregó en su lugar un flujo
  más plano (info general + cuenta remitente en una pantalla, steps como una lista con "Agregar
  step"/editor propio) cubriendo el mismo recorrido funcional acordado con el usuario
  (Cuenta → Steps → firma automática → prueba), sin la maquinaria de un wizard multi-pantalla que
  hoy no tiene más pasos que llenar.
- **Acciones del panel de lectura sin backend real** (Responder, Responder a todos, Archivar,
  Agregar etiquetas, Cambiar estado del prospecto, Detener secuencia) — visibles pero
  deshabilitadas desde el tercer ajuste post-entrega; requieren, respectivamente: un pipeline de
  envío de respuesta con hilos MIME reales, una entidad de etiquetas, `Contact`/estado de
  prospecto, y un scheduler/worker cuyos jobs futuros se puedan cancelar.
- **"Límites de envío" y "Sincronización"** dentro del panel de configuración de cuenta — siguen
  siendo placeholders explícitos ("no disponible en esta fase") desde el tercer ajuste: no existe
  todavía un modelo de límites/throttling en `Mailbox`, ni un worker de sincronización IMAP real
  que reportar. El cuarto ajuste sí completó "Conexión", "Asignaciones" (de solo lectura para el
  ejecutivo) y "Estado y diagnóstico" (resumen de mejor esfuerzo) con datos reales.
- **Contador de mensajes no leídos por cuenta** en la columna "Cuentas" de la bandeja estilo
  Outlook — `AssignedMailboxSummary`/`GET /me/mailboxes` no expone un agregado de no-leídos por
  buzón (el dato existe solo por hilo, dentro de cada bandeja ya cargada); agregarlo requeriría
  consultar el motor para cada cuenta asignada solo para pintar la lista, un costo que no se asumió
  sin que el usuario lo pidiera explícitamente más allá del condicional "si ya existe esa
  información" de la especificación.
- **Regla de "step desactivado se omite, continúa con el siguiente activo, cancela programaciones
  futuras"** — el campo Estado y su explicación son reales, pero no hay scheduler/worker que
  programe steps todavía (mismo pendiente de más arriba), por lo que no existe ninguna
  programación futura que cancelar cuando se desactiva un step.

## Fase 9 — Editor de firma enriquecido, imágenes, envío de prueba y responsable principal/secundario

Este pedido combinaba dos frentes de tamaño muy distinto: (A) rehacer firmas/asignación sobre
entidades que ya existían, y (B) un dominio de Secuencias/Steps completamente nuevo — que además
necesita una entidad `Contact` inexistente para variables como `{{contact.firstName}}`. Se acordó
con el usuario avanzar solo con (A) en esta entrega; (B) queda pendiente de diseño como una fase
propia. Dentro de (A), el wizard de 7 pasos para crear una cuenta (`setupStatus`, rutas
`/setup/imap`, `/setup/smtp`, etc.) también quedó fuera de esta entrega — se prefirió no construir
una máquina de estados sin la UI que la consuma. Lo que sí se entregó, completo y validado:

- **Firma en HTML real, no texto plano**: `SignatureVersion` pasó de un único `content: string` a
  `htmlContent` + `plainTextContent`. El texto plano se autogenera desde el HTML
  (`html-to-plain-text.ts`) cuando no se envía explícitamente, pero el campo queda editable aparte
  si se necesita revisar o corregir la conversión automática.
- **Editor enriquecido con Tiptap** (`@tiptap/*`, única librería de edición evaluada e instalada —
  no había ninguna en el proyecto): negrita, cursiva, subrayado, tachado, color de texto/fondo,
  alineación, listas, tipo y tamaño de fuente (extensión propia `font-size-extension.ts`, siguiendo
  el mismo patrón que `@tiptap/extension-color` usa para no chocar con `TextStyle`), enlaces,
  separadores, deshacer/rehacer, limpiar formato, y una vista de código HTML editable a mano
  (alternando con la vista visual).
- **Variables `{{sender.*}}` / `{{mailbox.*}}`**: namespaced con punto — requirió extender
  `VARIABLE_NAME_PATTERN` en `@outreach/validation` (antes solo aceptaba nombres sin punto; el
  cambio es compatible hacia atrás, todo nombre plano que ya era válido lo sigue siendo). Se
  resuelven con datos reales del ejecutivo asignado como principal a la cuenta (nombre, cargo,
  teléfono, correo — se agregaron `jobTitle`/`phone`, opcionales, a `User`) y el nombre de la
  organización; sin asignación todavía, cae a un ejemplo genérico claramente etiquetado como tal
  (`usesRealSenderData` en la respuesta de preview/API).
- **Sanitización de HTML en dos capas**: `sanitize-html` (fijado en `2.11.0` — versiones más nuevas
  traen `htmlparser2` como ESM puro, que rompe la transformación CJS de Jest) corre en el
  **frontend**, solo como red de seguridad al salir de la vista de código fuente, y de forma
  **obligatoria en el backend** (`HtmlSanitizerService`) en cada `create`/`update` — el backend es
  la fuente de verdad, nunca se confía solo en el editor del navegador. Lista blanca de etiquetas y
  estilos inline compatibles con clientes de correo (ver comentario de la clase para el detalle).
- **Carga de imágenes sin base64 en la base de datos**: nuevo `STORAGE_DRIVER=local|s3` (mismo
  patrón que `PERSISTENCE_DRIVER`/`ENGINE_DRIVER`). `local` (default de desarrollo) valida el tipo
  real por firma de bytes — no por extensión ni `Content-Type` declarado —, límite de 5&nbsp;MB, y
  guarda en `apps/api/uploads/<organizationId>/<uuid>.<ext>`, servido de vuelta por Express como
  contenido estático público (una imagen de firma debe cargar sin sesión, igual que en cualquier
  cliente de correo real). `s3` existe como adaptador seleccionable pero no configurado — no hay
  bucket disponible en este entorno, mismo criterio que `HttpEngineClient` con el motor real.
- **Envío de prueba de firma**: `EngineClient` ganó `sendMail()` (mock: acepta por defecto, y
  reutiliza la convención "+etiqueta" ya existente para simular un rechazo SMTP, ej.
  `destino+reject@ejemplo.com`). Nunca toca estado de campaña (no existe todavía), queda auditado
  sin guardar el destinatario ni el contenido — solo si fue aceptado y el código de error, si lo
  hubo.
- **Responsable principal y secundarios**: `MailboxAssignment` pasó de una tabla de unión plana
  (`mailboxId, userId`) a una entidad con `role: PRIMARY | SECONDARY`. Solo un principal por cuenta
  — esto **no** es una restricción de base de datos (Prisma no tiene una sintaxis portable para
  índice único parcial en el DSL del schema, y este proyecto nunca ha aplicado una migración real
  todavía), se aplica en `MailboxesService.setAssignees()`, el único lugar que escribe asignaciones.
  Asignar un ejecutivo inactivo se rechaza en el servidor, no solo se deshabilita en la UI.
- **"Textos" fuera del menú**: ver la sección de arriba.

### Endpoints nuevos de esta fase

```text
POST   /uploads/images                                  — signatures.update
POST   /mailboxes/:id/signature/send-test                — signatures.test (nuevo permiso)
```

`PUT /mailboxes/:id/assignees` cambió de cuerpo — antes `{ userIds: string[] }`, ahora
`{ primaryUserId: string | null, secondaryUserIds: string[] }` — y `AssigneeSummary` ganó `role` y
`status`. `POST`/`PATCH /mailboxes/:id/signature` cambiaron de `{ content }` a
`{ htmlContent, plainTextContent? }`, y todas las respuestas de firma (`SignatureVersionSummary`,
`SignaturePreview`) reflejan los dos campos por separado. Ninguno de estos cambios de contrato tenía
consumidores reales fuera de este repositorio (proyecto sin usuarios en producción todavía), así
que se reescribieron directamente en vez de mantener compatibilidad hacia atrás.

### Pendiente explícito (fuera de esta entrega)

- El wizard guiado de 7 pasos para crear una cuenta (`Datos → IMAP → SMTP → Validación → Firma →
Ejecutivos → Resumen`), con su propio `Mailbox.setupStatus` y capacidad de retomar una
  configuración incompleta. El backend de firmas/asignación ya quedó listo para que ese wizard lo
  consuma sin cambios adicionales.
- El dominio de Secuencias/Steps y el editor de cuerpo de correo dentro de cada step — necesita
  decidir primero un modelo de `Contact`/`ContactList`, que no existe en este proyecto.
- Font-family/tamaño en la firma usan una lista fija seleccionada por el usuario desde el toolbar;
  no hay todavía un selector de tablas ni de iconos de redes sociales predefinidos (el editor sí
  soporta tablas e imágenes vía HTML, solo no hay un botón dedicado para insertarlas con un clic).

## Fase actual: Fase 8 — Firmas de cuenta de correo, con versionado

CRUD de `Signature` (`signatures.read/create/update/preview/activate/archive/restore`) — una
firma por `Mailbox` (relación 1:1), pero **nunca se sobrescribe el contenido**: cada
`create`/`update` agrega una `SignatureVersion` inmutable a un historial y mueve un puntero
`activeVersionId` a la versión nueva; `activate` revierte ese puntero a una versión anterior sin
crear nada. `preview` sustituye cada `{{variable}}` de la versión activa por un valor de ejemplo
canned (no existe fase de contactos/campañas todavía que provea datos reales).

### Endpoints nuevos de esta fase

```http
GET    /mailboxes/:id/signature                          # signatures.read      — resumen + historial completo
POST   /mailboxes/:id/signature                           # signatures.create    — primera versión, activa de inmediato
PATCH  /mailboxes/:id/signature                           # signatures.update    — nueva versión, activa de inmediato
POST   /mailboxes/:id/signature/versions/:versionId/activate  # signatures.activate — revierte a una versión existente
POST   /mailboxes/:id/signature/archive                   # signatures.archive   — status ARCHIVED
POST   /mailboxes/:id/signature/restore                   # signatures.archive   — status ACTIVE
GET    /mailboxes/:id/signature/preview                   # signatures.preview   — versión activa con datos de ejemplo
```

`GET` responde **`404`** (nunca un cuerpo `null`) cuando la cuenta todavía no tiene firma — un
handler de NestJS que retorna `null` no serializa `null` en el JSON, envía una respuesta sin
cuerpo, y `await response.json()` en el cliente explota con eso. Se encontró escribiendo el
primer e2e de esta fase (`response.body` llegaba `{}`, no `null`) y se corrigió alineando esta
fase con la misma convención 404 que ya usa el resto de la API para "no existe", en vez de
inventar un contrato de respuesta distinto solo para este recurso.
`content` se valida con el mismo `IsValidTemplateText` que `Template.subject`/`.body` (Fase 6),
reexportado desde `modules/templates/validators/` en vez de duplicarlo.
`SignaturesService` reutiliza `extractTemplateVariables` de `@outreach/validation` tanto para
listar las variables de cada versión en el historial como para saber qué reemplazar en
`preview` — no hace falta lógica de parseo nueva, solo un mapa de valores de ejemplo
(`nombre` → "Juan Pérez", `empresa` → "Empresa Ejemplo S.A.", etc.; cualquier clave no reconocida
cae en `[valor de ejemplo]`).

### Endpoints heredados de la Fase 7

```http
GET    /variables              # variables.read     — lista de la organización
POST   /variables              # variables.create    — crea (valida la clave, exige unicidad)
GET    /variables/:id          # variables.read
PATCH  /variables/:id          # variables.update    — valida cualquier campo que se envíe
POST   /variables/:id/archive  # variables.archive   — status ARCHIVED
POST   /variables/:id/restore  # variables.archive   — status ACTIVE
```

Cada `Variable` tiene `key` (el identificador técnico, lo que se inserta como `{{key}}`),
`label` (nombre legible, ej. "Nombre del contacto"), `description` (opcional) y `source`
(`CONTACT` | `SENDER` | `CUSTOM` — de dónde vendría el valor cuando el motor real renderice la
plantilla; ninguna fase de contactos/campañas existe todavía, así que esto es una categoría que
el catálogo transporta hacia adelante, no algo que esta fase resuelve a un valor real). `key` es
única por organización (`409` si ya existe, igual que el correo de una cuenta); `@outreach
/validation` exporta `isValidVariableKey()` — mismas reglas de caracteres que un `{{...}}` dentro
de un texto de plantilla, para que toda clave del catálogo sea insertable de inmediato.
**No hay validación cruzada entre el catálogo y el texto libre de una plantilla** — una
plantilla puede seguir usando cualquier `{{variable}}` bien formada exista o no en el catálogo;
el catálogo es una ayuda de UI (autocompletado), no una restricción de contenido, para no romper
plantillas ya creadas en la Fase 6.

### Endpoints heredados de la Fase 6

```http
GET    /templates              # templates.read       — lista de la organización
POST   /templates              # templates.create      — crea (valida sintaxis de variables)
GET    /templates/:id          # templates.read
PATCH  /templates/:id          # templates.update      — valida cualquier campo que se envíe
POST   /templates/:id/duplicate  # templates.duplicate — copia con "(copia)" en el nombre
POST   /templates/:id/archive    # templates.archive   — status ARCHIVED
POST   /templates/:id/restore    # templates.archive   — status ACTIVE
DELETE /templates/:id            # templates.delete    — borrado lógico (deletedAt), 204
```

### Convención de variables `{{...}}` embebidas en una plantilla

`@outreach/validation` (`packages/validation`) exporta `validateTemplateVariables(text)`, la
única fuente de verdad para qué es una variable válida — usada tanto en el backend
(`IsValidTemplateText`, un validador `class-validator` custom aplicado a `subject` y `body` de
forma independiente en los DTOs) como en el frontend (vista previa en vivo mientras se escribe).
Una variable válida es `{{nombre}}`, donde `nombre` cumple `[a-zA-Z_][a-zA-Z0-9_]*` (espacios
alrededor permitidos: `{{ nombre }}`); se rechazan llaves sin cerrar y nombres con espacios,
números al inicio u otra puntuación, con un mensaje en español señalando el token exacto que
falló. `TemplatesService` también usa la misma función para derivar `variables: string[]`
(nombres únicos, en orden de aparición) que se muestra como chips en el listado y en el editor —
no es solo validación, es la misma lógica reutilizada para mostrar información derivada.
Ejemplo: `Hola {{nombre}}, una idea para {{empresa}}` → `variables: ["nombre", "empresa"]`.

### Endpoints heredados de la Fase 5

```http
GET    /mailboxes/:id/assignees  # mailboxes.assign          — lista de ejecutivos con acceso
PUT    /mailboxes/:id/assignees  # mailboxes.assign          — reemplaza la lista completa
GET    /me/mailboxes             # mailboxes.read.assigned   — cuentas asignadas al usuario autenticado
```

`setAssignees` recibe siempre la lista completa deseada (no altas/bajas individuales) y calcula
internamente qué agregar y qué quitar contra `MailboxAssignmentRepository` — así el picker de
casillas del panel admin siempre puede simplemente "guardar lo que está marcado ahora mismo".
Cada `userId` se valida contra la organización del llamador antes de tocar nada (`400` si no
pertenece); un id de mailbox ajeno responde `404`, nunca `403`, igual que el resto de la API.
`GET /me/mailboxes` devuelve un tipo deliberadamente más chico que `MailboxSummary`
(`AssignedMailboxSummary`: nombre, correo, remitente, estado, estado de conexión) — un ejecutivo
nunca ve host/puerto/usuario IMAP-SMTP de una cuenta que no configura directamente.

### Endpoints heredados de la Fase 4

```http
POST   /mailboxes/:id/test              # mailboxes.test      — ejecuta la prueba y guarda el resultado
GET    /mailboxes/:id/connection-tests  # mailboxes.read.all  — historial, más reciente primero
```

`testConnection` descifra las credenciales guardadas, las envía al `EngineClient` (nunca
persistidas ni logueadas en texto plano), actualiza `connectionStatus` / `lastTestedAt` /
`lastTestMessage` en la cuenta, escribe una entrada de historial y una entrada de auditoría —
todo en una sola operación de aplicación (`MailboxesService.testConnection`).

### Convención "+etiqueta" del motor simulado

Sin motor real todavía, `MockEngineClient` necesita una forma determinista (nunca aleatoria) de
que QA elija qué resultado quiere ver, sin inventar nueva superficie de API: un sufijo `+etiqueta`
en el correo de la cuenta selecciona el escenario.

| Sufijo en el correo              | Resultado                                  |
| -------------------------------- | ------------------------------------------ |
| _(ninguno)_                      | `CONNECTED`                                |
| `+credenciales` / `+credentials` | `CONNECTION_ERROR` (credenciales)          |
| `+timeout`                       | `CONNECTION_ERROR` (timeout)               |
| `+tls`                           | `CONNECTION_ERROR` (error TLS)             |
| `+imapdown`                      | `CONNECTION_ERROR` (IMAP no disponible)    |
| `+smtpdown`                      | `PARTIALLY_CONNECTED` (SMTP no disponible) |
| `+parcial` / `+partial`          | `PARTIALLY_CONNECTED`                      |
| `+motorcaido` / `+enginedown`    | `ENGINE_UNAVAILABLE`                       |

Ejemplo: `ventas+timeout@example.com`. Un `setScenario()` explícito (usado solo en pruebas)
siempre tiene prioridad sobre la etiqueta del correo. La pantalla `/dashboard/mailboxes` muestra
esta tabla como una nota visible cuando `ENGINE_DRIVER=mock`.

### Endpoints heredados de la Fase 3

```http
GET    /mailboxes              # mailboxes.read.all — lista de la organización
POST   /mailboxes              # mailboxes.create    — registra una cuenta (IMAP + SMTP)
GET    /mailboxes/:id          # mailboxes.read.all
PATCH  /mailboxes/:id          # mailboxes.update     — cualquier campo; la contraseña es opcional
POST   /mailboxes/:id/activate    # mailboxes.disable
POST   /mailboxes/:id/deactivate  # mailboxes.disable
```

### Cifrado de credenciales

Las contraseñas IMAP/SMTP se cifran con AES-256-GCM (`SecretEncryptionService`, clave
`CREDENTIALS_ENCRYPTION_KEY`) — cifrado **reversible**, nunca hashing, porque el motor
necesitará la contraseña real para conectarse. Esta es una implementación local adecuada para
esta fase; las notas de arquitectura completas del proyecto (fuera de este repo) especifican
envelope encryption + KMS externo para producción — cuando llegue ese momento, solo cambia la
implementación de `SecretEncryptionService`, no ningún llamador. Ningún endpoint devuelve la
contraseña ni el texto cifrado: las respuestas solo incluyen `credentialsConfigured: true`.
Verificado con una prueba e2e que revisa el JSON completo de la respuesta en busca de cualquier
rastro del secreto.

### Endpoints heredados de la Fase 2

```http
GET    /users                # users.read   — lista, con nombre de rol resuelto
POST   /users                # users.create — crea y asigna un rol
GET    /users/:id            # users.read
PATCH  /users/:id            # users.update — nombre, correo y/o rol (reemplaza el rol previo)
POST   /users/:id/activate   # users.disable
POST   /users/:id/deactivate # users.disable
GET    /roles                # roles.read   — solo lectura, para el selector de rol
```

Todos exigen `Authorization: Bearer <token>` y el permiso indicado (`PermissionsGuard`); el
`organizationId` siempre se toma del usuario autenticado, nunca de la URL o el body. Un `userId`
que existe pero pertenece a otra organización responde `404`, igual que uno que no existe — nunca
`403` (para no confirmar por canal lateral que el recurso existe en otro tenant).

### Pantallas nuevas

`/dashboard/mailboxes/[id]/edit` — sección "Firma de la cuenta" (visible con `signatures.read`):
si no hay firma, un formulario para crear la primera versión (`signatures.create`); si ya existe,
el mismo formulario pasa a "Guardar nueva versión" (`signatures.update`, la versión anterior
queda en el historial), con botones "Vista previa" (`signatures.preview`, sustituye
`{{variable}}` por datos de ejemplo bajo demanda, sin recargar la página) y
Archivar/Restaurar (`signatures.archive`). Debajo, un historial de versiones con fecha y un badge
"(activa)" en la vigente; cada versión anterior tiene un botón "Activar esta versión"
(`signatures.activate`) que revierte sin crear una versión nueva. `/dashboard/mailboxes/mine` —
las filas ahora tienen un enlace "Ver firma" (visible con `signatures.read`) hacia
`/dashboard/mailboxes/mine/[id]/signature`: una vista de solo lectura (sin editar, archivar ni
historial — el ejecutivo típico solo tiene `signatures.read`/`.preview`) que primero confirma que
la cuenta pedida aparece en `GET /me/mailboxes` del propio usuario antes de mostrar nada — el
scoping por asignación que `signatures.read` no impone a nivel de API queda cerrado aquí, en la
página, igual que ya ocurre con el resto de la superficie de "mis cuentas".

### Pantallas heredadas de la Fase 7

`/dashboard/variables` — tabla con buscador, filtro por estado, columna "Origen" con la etiqueta
en español de `CONTACT`/`SENDER`/`CUSTOM`; botones Editar y Archivar/Restaurar según
`variables.update`/`.archive`. `/dashboard/variables/new` y `/dashboard/variables/[id]/edit` —
formulario de clave, nombre, descripción y origen, con la misma retroalimentación instantánea de
formato que el editor de plantillas (usa `isValidVariableKey` de `@outreach/validation`) y una
vista previa de cómo queda el `{{key}}` resultante mientras se escribe. En
`/dashboard/templates/new` y `/dashboard/templates/[id]/edit` apareció un panel "Insertar
variable del catálogo": un chip por cada variable activa que, al hacer clic, inserta `{{key}}`
en el campo (asunto o cuerpo) que tenía el foco, en la posición exacta del cursor — sin pisar lo
ya escrito, sin duplicar espacios, funcionando igual de bien a mitad de una palabra que al final
del texto.

### Pantallas heredadas de la Fase 6

`/dashboard/templates` — tabla con buscador, filtro por estado y una columna "Variables" que
muestra cada `{{variable}}` detectada como chip; botones Editar / Duplicar / Archivar-Restaurar /
Eliminar según el permiso de cada acción (`templates.update` / `.duplicate` / `.archive` /
`.delete`), este último con confirmación del navegador por ser irreversible desde el panel.
`/dashboard/templates/new` y `/dashboard/templates/[id]/edit` — formulario de nombre, asunto y
cuerpo con **vista previa en vivo** de las variables: mientras se escribe, cada `{{...}}` bien
formado aparece como chip y cada uno mal formado muestra su error en español al instante, sin
esperar a enviar el formulario (misma función `validateTemplateVariables` que el backend usa para
rechazar el envío si igual se fuerza).

### Pantallas heredadas de la Fase 5

`/dashboard/mailboxes/[id]/edit` — sección "Ejecutivos con acceso a esta cuenta" (visible solo con
`mailboxes.assign`): una lista de casillas con todos los usuarios de la organización, marcadas
según la asignación actual; "Guardar asignación" hace un `PUT` con la lista completa de ids
marcados. `/dashboard/mailboxes/mine` — pantalla para ejecutivos (`mailboxes.read.assigned`):
tabla de solo lectura con las cuentas que tiene asignadas (nombre, correo, remitente, estado,
estado de conexión), sin ningún detalle de host/usuario IMAP-SMTP. El ítem "Cuentas de correo"
del dashboard resuelve a `/dashboard/mailboxes` para quien tiene `mailboxes.read.all` o a
`/dashboard/mailboxes/mine` para quien solo tiene `mailboxes.read.assigned` — el mismo ítem del
menú, dos pantallas distintas según el permiso.

### Pantallas heredadas de la Fase 4

`/dashboard/mailboxes` — la columna de estado de conexión refleja el resultado real de la última
prueba (con el mensaje legible como tooltip) y cada fila con `mailboxes.test` tiene un botón
"Probar conexión" que dispara la prueba y refresca la fila; cuando `ENGINE_DRIVER=mock` se
muestra la tabla de convención "+etiqueta" descrita arriba. `/dashboard/mailboxes/[id]/edit` —
debajo del formulario hay un historial de pruebas (fecha, resultado, estado de IMAP/SMTP
individual, mensaje), visible solo con `mailboxes.read.all`.

### Pantallas heredadas de la Fase 3

`/dashboard/mailboxes/new` y `/dashboard/mailboxes/[id]/edit` — formularios con secciones IMAP y
SMTP separadas; el de edición deja la contraseña en blanco ("dejar en blanco para mantener la
actual") en vez de mostrar cualquier valor existente.

### Pantallas heredadas de la Fase 2

`/dashboard/executives` — tabla con buscador y filtro por estado (vía query params, sin
JavaScript necesario para filtrar); `/dashboard/executives/new` y `/dashboard/executives/[id]/edit`
— formularios de creación y edición con selector de rol poblado desde `GET /roles`. El enlace
"Ejecutivos" del dashboard solo aparece activo si el usuario tiene `users.read`; sin ese permiso,
la ruta responde con un mensaje de acceso denegado en vez de la tabla.

## Stack

TypeScript · NestJS · Next.js (App Router) · React · Tailwind CSS · PostgreSQL · Prisma ·
OpenAPI/Swagger · Jest · Supertest · ESLint · Prettier.

## Identidad visual

El nombre del producto es **Mr. Outreach**. El logo fuente vive en `logo/mr-logo.png` (lockup con
el nombre de la empresa, MejoReferido); de ahí se recortó únicamente el glyph de rombos como
ícono de marca (`apps/web/app/icon.png` — favicon automático de Next.js, y
`apps/web/public/brand-icon.png` — usado inline junto al texto "Mr. Outreach" por
`apps/web/app/brand.tsx`, el componente `<BrandMark />` compartido por todas las pantallas). La
paleta (`apps/web/tailwind.config.ts`, colores `brand.*` y `accent.*`) se extrajo por color
dominante directamente de los píxeles del logo: morado oscuro `#582068` → `#2E1236`, violeta
medio `#8B3FC9` (color interactivo por defecto: botones primarios, enlaces, foco de inputs) y
naranja `#F5991C` como acento secundario. El fondo general usa un degradado sutil
`brand-50 → white`.

## El principio que gobierna esta fase: dos modalidades de ejecución

La base de datos remota (Hetzner) y el motor de ejecución los prepara otra persona y **todavía no
están disponibles**. Eso no bloquea el desarrollo: la aplicación corre en dos modalidades
intercambiables, seleccionadas solo por variables de entorno.

```env
# Modalidad simulada — la que se usa para desarrollar ahora mismo.
PERSISTENCE_DRIVER=memory
ENGINE_DRIVER=mock
```

```env
# Modalidad integrada — se activa cuando Hetzner y el motor real estén listos.
PERSISTENCE_DRIVER=postgres
ENGINE_DRIVER=http
DATABASE_URL=postgresql://...
ENGINE_BASE_URL=https://...
```

**`MAIL_ENGINE_MODE` (Fase 12) es una tercera variable, independiente de las dos de arriba** —
gobierna un puerto distinto (`MailEnginePort`, ver Fase 12 más abajo), no `EngineClient`. Los dos
puertos conviven: `ENGINE_DRIVER` sigue controlando la prueba de conexión síncrona y la lectura de
bandeja bajo demanda (sin cambios); `MAIL_ENGINE_MODE` controla el nuevo flujo asíncrono de
comandos/eventos (aprovisionamiento, publicación de secuencias, importaciones, envíos, respuestas).

```env
MAIL_ENGINE_MODE=simulation   # valor por defecto — motor simulado, ver Fase 12.
# MAIL_ENGINE_MODE=remote     # adaptador preparado pero no implementado todavía (ver Fase 12).
```

**`SEQUENCE_MOTOR_MODE` (Consolidación contractual) es una CUARTA variable, independiente de
las anteriores** — gobierna `SequenceTemplateMotorPort`/`SequenceExecutionMotorPort`: el motor
Railway que acepta una versión publicada de Plantilla y arranca una Gestión. Ver
`docs/railway-integration-contract-v1.md` para el contrato completo (payloads reales,
respuestas, idempotencia, reglas de versionado inmutable).

```env
SEQUENCE_MOTOR_MODE=simulated        # valor por defecto — SimulatedSequenceTemplate/ExecutionMotorAdapter.
# SEQUENCE_MOTOR_MODE=http           # requiere SEQUENCE_MOTOR_BASE_URL y SEQUENCE_MOTOR_API_KEY (la API
                                      # rechaza arrancar si falta cualquiera de las dos).
SEQUENCE_MOTOR_BASE_URL=
SEQUENCE_MOTOR_API_KEY=
SEQUENCE_MOTOR_TIMEOUT_MS=10000
```

**`SIGNATURE_ASSET_STORAGE_MODE` (Fase Firma) es independiente de las anteriores** — gobierna
`SignatureAssetStoragePort`: dónde se guardan las imágenes que un ejecutivo (o el administrador
operando como tal) inserta en la firma de una Plantilla. Distinto de `STORAGE_DRIVER` (el puerto
genérico de imágenes de texto enriquecido, más antiguo). Ver `docs/signature-assets-r2-setup.md`
para los pasos externos de Cloudflare R2.

```env
SIGNATURE_ASSET_STORAGE_MODE=simulated   # valor por defecto — SimulatedSignatureAssetStorageAdapter,
                                          # escribe en apps/api/uploads/signatures/ (mismo mount /uploads/*).
# SIGNATURE_ASSET_STORAGE_MODE=r2        # requiere las 4 variables R2_* de abajo (la API rechaza
                                          # arrancar si falta cualquiera).
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=https://assets.mejoreferido.com   # siempre requerida — el sanitizador de la
                                                       # firma solo permite <img> apuntando a este host.
R2_SIGNATURE_PREFIX=signatures
```

Ningún servicio de negocio conoce cuál de las dos está activa: todos dependen de **interfaces**
(`UserRepository`, `RoleRepository`, `EngineClient`, etc.), nunca de Prisma, `pg`, Axios/fetch o
el motor externo directamente. Ver "Arquitectura: puertos y adaptadores" más abajo.

## Estructura del repositorio

```text
outreach-platform/
├── apps/
│   ├── web/                 # Next.js App Router
│   └── api/                 # NestJS
│       └── src/
│           ├── domain/              # entidades + interfaces de repositorio (puertos)
│           ├── application/          # casos de uso (AuthService, AuthorizationService)
│           ├── infrastructure/
│           │   ├── config/           # validación de env + AppConfigService (selector central)
│           │   ├── security/         # SecretEncryptionService (AES-256-GCM)
│           │   ├── persistence/
│           │   │   ├── memory/       # adaptadores en memoria
│           │   │   ├── prisma/       # adaptadores Prisma
│           │   │   └── contracts/    # misma suite de pruebas para ambos adaptadores
│           │   └── engine/
│           │       ├── mock/         # MockEngineClient
│           │       └── http/         # HttpEngineClient
│           └── modules/       # controladores NestJS (auth, health, seed, users, mailboxes, templates)
├── packages/
│   ├── shared-types/        # tipos TS compartidos entre api y web
│   ├── validation/          # validateTemplateVariables — compartida entre api y web (Fase 6)
│   └── ui/                  # componentes compartidos (placeholder)
├── prisma/
│   ├── schema.prisma
│   ├── migrations/           # generadas sin necesitar una base real (ver más abajo)
│   └── seed.ts                # seed manual para PERSISTENCE_DRIVER=postgres
├── infra/
│   └── docker-compose.yml    # reservado para empaquetar la app; sin Postgres local
├── package.json
├── tsconfig.base.json
└── README.md
```

## Arquitectura: puertos y adaptadores

Cada recurso principal (`Organization`, `User`, `Role`, `Permission`, la relación
`User`↔`Role`, `AuditLog`, y el motor) tiene:

1. Una **interfaz** en `domain/` (el puerto) — p. ej. `UserRepository`.
2. Un **adaptador en memoria** en `infrastructure/persistence/memory/` — p. ej.
   `InMemoryUserRepository`.
3. Un **adaptador Prisma** en `infrastructure/persistence/prisma/` — p. ej.
   `PrismaUserRepository`.

`infrastructure/persistence/persistence.module.ts` es el único lugar que decide cuál adaptador
registrar, leyendo `AppConfigService.persistenceDriver`. Nada más en la aplicación lee
`PERSISTENCE_DRIVER`/`ENGINE_DRIVER` directamente — así se evita que la selección de adaptador
quede dispersa por todos los módulos. El mismo patrón aplica a `EngineClient`
(`MockEngineClient` / `HttpEngineClient`, seleccionados en `engine.module.ts`).

Cuando `PERSISTENCE_DRIVER=memory`, `PrismaService` **nunca se instancia** — no solo no se usa,
literalmente no se construye el objeto — por lo que no hay ningún intento de conexión a
PostgreSQL. Esto está verificado por la prueba e2e de salud (`/health/ready` reporta
`persistence.status: "available"` sin `DATABASE_URL`).

## Modalidad simulada (la actual)

- La API inicia **sin** `DATABASE_URL` ni `ENGINE_BASE_URL`.
- Los datos viven en memoria del proceso (`MemoryStore`) — se pierden al reiniciar la API.
- Al arrancar, `DevSeedService` carga automáticamente:
  - Organización **MejoReferido**.
  - Catálogo completo de permisos (`modules/seed/permission-catalog.ts`).
  - Rol **ADMIN** (todos los permisos) y rol **EXECUTIVE** (permisos acotados).
  - Usuario administrador (`DEV_ADMIN_EMAIL` / `DEV_ADMIN_PASSWORD`).
  - Usuario ejecutivo de prueba (`DEV_EXECUTIVE_EMAIL` / `DEV_EXECUTIVE_PASSWORD`).
  - 2 ejecutivos adicionales solo de demostración (1 activo, 1 inactivo, nombre con sufijo
    "(Demo)", sin contraseña documentada — no pensados para iniciar sesión).
  - 2 cuentas de correo de demostración (1 activa, 1 inactiva) con host/dominio inventado
    (`*.mejoreferido-demo.test`) para que la lista no se vea vacía.
  - 2 plantillas de demostración (1 activa con variables `{{nombre}}`/`{{empresa}}`, 1 archivada).
  - 3 variables de demostración (`nombre`/`empresa` activas con origen `CONTACT`, `firma`
    archivada con origen `SENDER`) — las mismas que el picker del editor de plantillas ofrece.
  - 1 firma de demostración en la cuenta "Ventas (Demo)", con 2 versiones (la primera queda en
    el historial, la segunda es la activa) para que la lista de versiones y "activar una versión
    anterior" tengan algo real que mostrar sin pasar antes por el flujo completo.
- El motor se simula con `MockEngineClient`: resultados deterministas (nunca aleatorios),
  seleccionables por escenario — ver su código para las variantes disponibles (conexión exitosa,
  error de credenciales, timeout, error TLS, IMAP/SMTP no disponible, conexión parcial, motor no
  disponible).

## Modalidad integrada (cuando Hetzner y el motor estén listos)

Cambiar `PERSISTENCE_DRIVER=postgres` y `ENGINE_DRIVER=http`, completar `DATABASE_URL` /
`ENGINE_BASE_URL` / `ENGINE_API_KEY`. La lógica de negocio (`AuthService`,
`AuthorizationService`, controladores) no cambia ni una línea — solo cambia qué adaptador
resuelve cada token de inyección.

## Variables de entorno

```env
NODE_ENV=development

PERSISTENCE_DRIVER=memory   # memory | postgres
ENGINE_DRIVER=mock          # mock | http
STORAGE_DRIVER=local        # local | s3 — imágenes de firma; s3 no está configurado en este entorno

DATABASE_URL=                # obligatoria solo si PERSISTENCE_DRIVER=postgres
DIRECT_URL=                   # solo la usan `prisma migrate`/`db` — mismo valor que DATABASE_URL
                               # salvo que sea una conexión pooled (Neon "-pooler", PgBouncer)
ENGINE_BASE_URL=              # obligatoria solo si ENGINE_DRIVER=http
ENGINE_API_KEY=

SEQUENCE_MOTOR_MODE=simulated # simulated | http — motor Railway de Plantillas/Gestiones
SEQUENCE_MOTOR_BASE_URL=      # obligatoria solo si SEQUENCE_MOTOR_MODE=http
SEQUENCE_MOTOR_API_KEY=       # obligatoria solo si SEQUENCE_MOTOR_MODE=http
SEQUENCE_MOTOR_TIMEOUT_MS=10000

SIGNATURE_ASSET_STORAGE_MODE=simulated  # simulated | r2 — imágenes embebidas en la firma de una Plantilla
R2_ACCOUNT_ID=                # obligatoria solo si SIGNATURE_ASSET_STORAGE_MODE=r2
R2_ACCESS_KEY_ID=              # obligatoria solo si SIGNATURE_ASSET_STORAGE_MODE=r2
R2_SECRET_ACCESS_KEY=          # obligatoria solo si SIGNATURE_ASSET_STORAGE_MODE=r2
R2_BUCKET_NAME=                # obligatoria solo si SIGNATURE_ASSET_STORAGE_MODE=r2
R2_PUBLIC_BASE_URL=https://assets.mejoreferido.com  # siempre requerida (con valor por defecto)
R2_SIGNATURE_PREFIX=signatures

API_PUBLIC_URL=               # opcional; base para las URLs públicas de /uploads (default http://localhost:<PORT>)

AUTH_SECRET=replace_with_a_secure_value   # siempre obligatoria — firma los JWT de sesión
CREDENTIALS_ENCRYPTION_KEY=replace_with_a_base64_32_byte_key  # siempre obligatoria — cifra contraseñas IMAP/SMTP

DEV_ADMIN_EMAIL=admin@local.test              # usados solo por el seed en memoria
DEV_ADMIN_PASSWORD=replace_with_a_secure_value
DEV_EXECUTIVE_EMAIL=ejecutivo@local.test
DEV_EXECUTIVE_PASSWORD=replace_with_a_secure_value
```

La aplicación **falla al iniciar** (no arranca en un estado a medias) si falta una variable
obligatoria para el modo seleccionado — validado con un esquema Joi
(`infrastructure/config/env.validation.ts`), no con chequeos manuales dispersos.

### Nunca se solicitan credenciales reales por chat

Las cadenas de conexión reales (Hetzner) y las claves del motor real **nunca** se piden ni se
incluyen en el repositorio, el chat, commits o documentación. Solo existen plantillas
`*.example`; los valores reales se colocan manualmente en los archivos `.env*` (gitignored).

## Entornos separados

```text
Development   → NODE_ENV=development  (por defecto; modalidad simulada hoy)
Staging       → NODE_ENV=staging       (modalidad integrada)
Production    → NODE_ENV=production    (modalidad integrada)
```

Plantillas versionadas: `.env.example`, `.env.development.example`, `.env.staging.example`,
`.env.production.example`. Los archivos reales (`.env`, `.env.development`, `.env.staging`,
`.env.production`) nunca se suben (`.gitignore`); `.env.test` sí está versionado porque solo
contiene valores ficticios usados por la suite de pruebas (ver "Pruebas").

`apps/api` busca las variables en este orden, usando el primer archivo que exista:

```text
apps/api/.env.<NODE_ENV>
apps/api/.env
<repo-root>/.env.<NODE_ENV>
<repo-root>/.env
```

**No se ejecutan pruebas automáticas, seeds de desarrollo ni migraciones experimentales contra
la base de datos de producción.**

## Prisma: núcleo administrativo + persistencia operativa (Fase 1), ya aplicado contra una base real

`prisma/schema.prisma` define el núcleo administrativo (`Organization`, `User`, `Role`,
`Permission`, `Mailbox`, `Template`, `Variable`, `Signature`, `Sequence`, `ManagedClient`,
`Domain`, etc.) y, desde Fase 1, el núcleo operativo (`IntegrationCommand`, `IntegrationEvent`,
`Company`, `Contact`, `SequenceImport`, `SequenceImportRow`, `SequenceContact`, `ScheduledEmail` —
ver "Persistencia PostgreSQL (Fase 1)" más arriba para el detalle). `prisma generate` sigue sin
necesitar ninguna base de datos alcanzable.

Dos migraciones, **ambas ya aplicadas de verdad** contra los branches `development` y `test` del
proyecto Neon dedicado "Mr Outreach" (vía `prisma migrate deploy`, no solo generadas y sin
verificar): `prisma/migrations/20260730000000_init_mr_outreach/` (esquema completo consolidado,
generado desde un estado vacío) y
`prisma/migrations/20260730000001_restore_case_insensitive_unique_indexes/` (2 índices únicos
parciales agregados a mano al SQL generado — Prisma no tiene sintaxis declarativa para "único
mientras no esté eliminado" ni para comparación insensible a mayúsculas) — ver los comentarios en
el propio archivo `migration.sql`.

Flujo de migraciones hacia un entorno real (Development/Staging/Production):

1. `prisma migrate dev` en Development, contra el entorno reachable correspondiente.
2. Validar en Staging.
3. Solo entonces, `prisma migrate deploy` en Production. **Nunca** `prisma db push` en
   producción.
4. Migraciones versionadas en `prisma/migrations/` dentro de Git.

`prisma/seed.ts` siembra los mismos datos que `DevSeedService` (organización, permisos, roles,
admin, ejecutivo) pero para el driver `postgres` — se ejecuta manualmente
(`npm run prisma:seed`) una vez que exista una base Development real; se niega a correr si
`NODE_ENV=production`.

## Requisitos previos

- Node.js 20+ (probado con Node 24).
- npm 10+.
- **Nada más** para desarrollar en modalidad simulada — sin Docker, sin PostgreSQL, sin el motor
  real.

## Instalación

```bash
npm install

cp .env.example .env                          # PERSISTENCE_DRIVER=memory, ENGINE_DRIVER=mock por defecto
cp apps/api/.env.example apps/api/.env        # PORT, WEB_ORIGIN, NODE_ENV
cp apps/web/.env.example apps/web/.env.local  # NEXT_PUBLIC_API_URL, API_INTERNAL_URL

# Edita ".env" en la raíz: define AUTH_SECRET y las credenciales DEV_ADMIN_*/DEV_EXECUTIVE_*
# (valores propios, no las que aparecen en el .example).
```

## Ejecutar en desarrollo

```bash
npm run dev
```

- API en `http://localhost:3001` (`/health/live`, `/health/ready`, Swagger en `/docs`).
- Web en `http://localhost:3000`.

Inicia sesión en `http://localhost:3000/login` con las credenciales `DEV_ADMIN_EMAIL` /
`DEV_ADMIN_PASSWORD` (o las del ejecutivo) que hayas definido en `.env`.

### Cómo funciona el login (patrón BFF)

El navegador nunca ve el JWT. `POST /api/auth/login` (Route Handler de Next.js) llama al API
NestJS servidor-a-servidor, recibe el `accessToken` y lo guarda en una cookie `httpOnly` propia
de Next — el navegador solo recibe esa cookie, nunca el token en JSON. Las páginas del servidor
(`/dashboard`) leen la cookie y llaman a `GET /auth/me` para obtener el usuario y sus permisos
**siempre frescos** (nunca cacheados en el token), de modo que desactivar un usuario o cambiarle
el rol tiene efecto inmediato, no solo tras un nuevo login. `middleware.ts` protege `/dashboard`
redirigiendo a `/login` si no hay cookie de sesión.

## Pruebas

```bash
npm run test         -w apps/api  # Jest — unitarias, incluye las de contrato en modo memoria
npm run test:e2e      -w apps/api  # Jest + Supertest — end-to-end
npm run test:integration -w apps/api  # Jest — contrato + reinicio contra PostgreSQL real (ver abajo)
```

`test` y `test:e2e` corren enteramente en modalidad simulada — **sin PostgreSQL, sin Hetzner, sin
motor real, sin SMTP/IMAP real** — usando `.env.test` (versionado a propósito: solo contiene
valores ficticios, nunca secretos reales). `test:integration` es la excepción: necesita
`TEST_DATABASE_URL` apuntando a una PostgreSQL real y descartable (ver "Persistencia PostgreSQL
(Fase 1)" más arriba) — sin esa variable, cada suite se salta sola (`describe.skip`).

Todos los specs e2e arrancan la app a través de `test/create-test-app.ts`, que aplica el mismo
`ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) que `main.ts` usa en
producción. Antes de la Fase 6 cada spec llamaba `Test.createTestingModule(...).compile()`
directamente sin ese pipe — los DTOs nunca se validaban en las pruebas e2e, solo en el servidor
real. Se detectó al escribir los primeros e2e de `templates` (una variable mal formada volvía
`201` en vez de `400`) y se corrigió centralizando el bootstrap para las 5 suites existentes, no
solo la nueva.

- **`@outreach/validation`**: sintaxis de `{{variable}}` — nombre válido con espacios internos
  permitidos, rechazo de nombre que empieza con dígito o contiene espacios/puntuación, llaves sin
  cerrar, deduplicación en orden de aparición, reporte de cada token malformado (no solo el
  primero) — y `isValidVariableKey`, las mismas reglas de caracteres aplicadas a una clave de
  catálogo independiente (sin llaves).
- **Pruebas de contrato de repositorios**
  (`infrastructure/persistence/contracts/*.contract.ts`): la misma suite de comportamiento se
  ejecuta contra el adaptador en memoria y contra el adaptador Prisma de cada entidad — 15 pares
  hoy (el núcleo administrativo: User/Role/Mailbox/Template/Variable/Signature/ManagedClient, y el
  núcleo operativo: IntegrationCommand/IntegrationEvent/Company/Contact/SequenceImport/
  SequenceImportRow/SequenceContact/ScheduledEmail). Las specs Prisma (`*.contract.spec.ts`) usan
  `describe.skip` sin `TEST_DATABASE_URL` definida; con `npm run test:integration` corren de
  verdad — las 22 suites (15 pares de contrato + `restart-durability` + los `.integration.spec.ts`
  de mailboxes/sequences/sequence-imports/sequence-contacts) se ejecutaron y pasaron contra el
  branch `test` real del proyecto Neon dedicado "Mr Outreach", incluyendo aislamiento
  multiempresa, unicidad de idempotencia/dedupe, y conversión de JSONB/fechas/enums. Además,
  `restart-durability.integration.spec.ts` demuestra que un comando,
  sus eventos, una importación, un contacto, una relación contacto-secuencia y un trabajo
  programado sobreviven a una desconexión + reconexión completa de Prisma (un reinicio real, no
  solo "otro repositorio en el mismo proceso").
- **TemplatesService**: extrae variables únicas de asunto + cuerpo en orden de aparición,
  actualiza solo los campos enviados (sin pisar `subject`/`body` con `undefined`), duplicar nunca
  muta el original, archivar/restaurar audita la acción correcta en cada dirección, borrado
  lógico exige la misma regla 404-no-403 que el resto de la API.
- **VariablesService**: actualiza solo los campos enviados, archivar/restaurar audita la acción
  correcta en cada dirección, aislamiento 404-no-403 entre organizaciones.
  `InMemoryVariableRepository`/`PrismaVariableRepository` (vía contrato): unicidad de `key` por
  organización (`409`), la misma clave se permite en organizaciones distintas, renombrar a una
  clave ya usada por otra variable de la misma organización se rechaza.
- **MockEngineClient**: probado exhaustivamente (cada escenario de conexión, la convención
  "+etiqueta" completa, prioridad de `setScenario()` explícito sobre la etiqueta, comportamiento
  determinista, `checkHealth`).
- **SecretEncryptionService**: ida y vuelta cifrado/descifrado, IV aleatorio (nunca el mismo
  texto cifrado dos veces para el mismo valor), rechazo de texto cifrado alterado.
- **MailboxesService.testConnection / getConnectionTests**: descifra y reenvía las credenciales
  correctas al `EngineClient`, actualiza estado/historial/auditoría, mensajes distintos por
  escenario (incl. conexión parcial), aislamiento entre organizaciones (`404`, nunca `403`), y
  una aserción explícita de que ninguna respuesta contiene el secreto ni su forma cifrada.
- **MailboxesService.setAssignees / getAssignees / getAssignedMailboxesForUser** (Fase 9: reescrito
  para `primaryUserId`/`secondaryUserIds`): upsertea principal/secundarios y elimina por diferencia
  contra el estado actual, rechaza (`400`) un `userId` de otra organización o inactivo sin asignar
  nada, dedupe cuando el mismo id aparece como secundario y principal, descarta silenciosamente un
  assignee que ya no resuelve a un usuario válido, confirma que `AssignedMailboxSummary` nunca
  incluye `imap`/`smtp`.
- **SignaturesService** (Fase 9: `htmlContent`/`plainTextContent`, sanitización, `sendTest`):
  crear sanitiza el HTML y autogenera el texto plano cuando no se envía uno explícito, activa la
  primera versión de inmediato; editar agrega una versión y la activa, dejando la anterior en el
  historial; `activateVersion` revierte sin crear nada y rechaza un `versionId` de otra firma;
  `preview` resuelve `{{sender.*}}`/`{{mailbox.*}}` desde el ejecutivo principal asignado cuando
  existe (`usesRealSenderData: true`) o cae a un ejemplo genérico cuando no, y cualquier variable
  desconocida cae a `[valor de ejemplo]`, sin dejar ningún `{{...}}` sin reemplazar;
  `sendTest` descifra el SMTP de la cuenta, entrega la contraseña en texto plano solo al
  `EngineClient` (nunca la persiste ni la audita), y audita únicamente el resultado booleano;
  aislamiento 404-no-403 entre organizaciones en cada operación.
- **`HtmlSanitizerService`**: elimina `<script>` y su contenido, elimina `onclick` y cualquier
  manejador de eventos inline, bloquea `<iframe>`/`<form>`, conserva la lista blanca de etiquetas
  intacta, agrega `rel="noopener noreferrer"` a los enlaces, rechaza una URL `javascript:`,
  conserva un estilo inline permitido y descarta uno que no lo está.
- **`htmlToPlainText`**: convierte `<br>`/cierres de bloque en saltos de línea, decodifica
  entidades comunes, convierte `<li>` en líneas con guion, colapsa líneas en blanco excesivas.
- **`sniffImageType`**: reconoce PNG/JPEG/GIF/WebP por los bytes mágicos reales, rechaza un
  archivo no-imagen renombrado con extensión `.png`, rechaza un buffer demasiado corto.
- **`signature-variable-resolver`**: resuelve `{{sender.*}}` desde un ejecutivo real (incluyendo
  separar nombre/apellido) o cae al ejemplo genérico etiquetado cuando no hay ejecutivo asignado o
  el campo nunca se completó; `{{mailbox.email}}` siempre viene del buzón; cualquier otra clave cae
  al mapa de ejemplo genérico compartido con Templates/Variables.
- **Auth e2e**: login de admin y ejecutivo (permisos correctos y distintos), credenciales
  inválidas (mensaje genérico, sin revelar si el correo existe), `/auth/me` con y sin token,
  token corrupto.
- **Mailboxes e2e**: creación con IMAP+SMTP, edición sin reenviar la contraseña,
  activar/desactivar, correo duplicado, id inexistente, prueba de conexión rechazada para un
  ejecutivo (`403`), prueba exitosa que actualiza `connectionStatus` y el historial, la
  convención "+etiqueta" produciendo un resultado determinista de conexión parcial, dos pruebas
  consecutivas quedando en el historial más reciente primero, asignar un ejecutivo y verlo
  reflejado en `GET /me/mailboxes`, quitarlo de la lista y confirmar que pierde acceso,
  `userId` inválido rechazado con `400`, `mailboxes.assign` exigido para gestionar asignaciones
  — y una aserción explícita de que el JSON completo de cada respuesta nunca contiene la
  contraseña en texto plano ni su forma cifrada.
- **Templates e2e**: un ejecutivo (`templates.read` solamente) puede listar pero no
  crear/editar/duplicar/archivar/eliminar; asunto o cuerpo con variable mal formada rechazados
  con `400` en creación y en edición (sin dejar el registro a medio modificar); duplicar produce
  un segundo registro con "(copia)" y el mismo contenido; archivar/restaurar alternan el estado;
  borrado lógico saca el registro tanto de la lista como del lookup directo (`404`); id
  inexistente responde `404`, nunca `403`.
- **Variables e2e**: un ejecutivo (sin ningún permiso `variables.*`) no puede listar ni crear;
  clave con caracteres inválidos rechazada con `400`; `source` fuera del enum rechazado con
  `400`; clave duplicada en la misma organización rechazada con `409`; editar solo el nombre deja
  la clave intacta; archivar/restaurar alternan el estado; id inexistente responde `404`, nunca
  `403`.
- **Signatures e2e** (Fase 9): `GET` responde `404` (nunca un cuerpo `null`) cuando la cuenta no
  tiene firma; un ejecutivo con `signatures.read`/`.preview`/`.test` puede leer, previsualizar y
  enviar una prueba, pero no crear/editar/archivar; contenido con variable mal formada rechazado
  con `400`; un `<script>`/`onclick` enviado se sanitiza antes de guardarse; una segunda firma
  para la misma cuenta rechazada con `409`; editar agrega una versión y la activa, conservando el
  contenido anterior en el historial; se puede enviar texto plano explícito en vez de autogenerarlo;
  activar una versión anterior revierte sin sumar una versión nueva; archivar/restaurar no tocan la
  versión activa; la vista previa nunca deja `{{`/`}}` en el HTML renderizado y usa datos reales del
  ejecutivo principal asignado cuando existe; el envío de prueba acepta por defecto y rechaza con la
  convención `+reject` del motor simulado; id de cuenta inexistente responde `404`, nunca `403`.
- **Uploads e2e**: sube un PNG válido (por firma de bytes) y devuelve una URL pública bajo
  `/uploads/`; rechaza un archivo no-imagen aunque tenga extensión `.png`; rechaza la petición sin
  archivo adjunto; exige autenticación (`401`); un ejecutivo sin `signatures.update` no puede subir
  (`403`).
- **Health e2e**: `/health/live` siempre 200; `/health/ready` refleja memory+mock.

## Identidad de cliente: token del servidor, no un CRM

Mr Outreach no lee ningún catálogo externo (CRM/portal) directamente — ya no existe un
`CRM_DRIVER`/`CRM_DATABASE_URL` ni una conexión Postgres independiente hacia otra base. La
identidad de un `ManagedClient` (nombre, RUT, estado externo) se resuelve exclusivamente a partir
del payload que el servidor externo entrega al redimir un token de vinculación de cuenta de
correo (`LinkMailboxUseCase`, ver `docs/motor-mailbox-link-contract-v1.md`), y se guarda como un
snapshot local (`clientRutSnapshot`/`externalStatusSnapshot`/`externalStatusCheckedAt`) — nunca se
vuelve a consultar esa fuente para confirmar cada operación nueva; el gate de elegibilidad
(`ClientEligibilityService`) evalúa el estado local (`ManagedClient.status` +
`externalStatusSnapshot`), sin ninguna llamada de red adicional.

## Lint y formato

```bash
npm run lint
npm run format:check
```

## Limitaciones conocidas de la modalidad en memoria

Documentadas explícitamente para no confundirlas con validación real de producción. **Desde
Fase 1, las primeras tres ítems ya NO aplican** al núcleo administrativo ni al operativo
(comandos/eventos/empresas/contactos/importaciones/filas/contactos-en-secuencia/trabajos) cuando
se usa `PERSISTENCE_DRIVER=postgres` — se validaron de verdad contra una base Neon real (ver
"Persistencia PostgreSQL (Fase 1)" más arriba). Siguen aplicando al resto:

- ~~No valida persistencia después de reinicios~~ — validado para las 8 entidades de Fase 1 vía
  `restart-durability.integration.spec.ts`. Las conversaciones (mensajes/notas/etiquetas) siguen
  solo en memoria y sí pierden datos al reiniciar.
- ~~No valida las migraciones reales de Prisma contra PostgreSQL~~ — ambas migraciones ya se
  aplicaron (`prisma migrate deploy`) contra `mr-outreach-test`.
- ~~No valida restricciones nativas de PostgreSQL~~ — validado para las 8 entidades de Fase 1
  (incluyendo los dos índices únicos parciales agregados a mano a la migración).
- No valida transacciones, bloqueos ni concurrencia real de base de datos más allá de las
  restricciones únicas ya probadas (protegen contra una carrera real, pero no hay todavía
  optimistic locking ni un patrón outbox completo).
- No mide rendimiento real.
- No valida recuperación ante una caída real de PostgreSQL en producción, ni conectividad con
  Hetzner (las pruebas de Fase 1 corrieron contra Neon, una base de prueba separada).
- No valida la integración real con el motor de ejecución (solo sus contratos simulados).
- Conversaciones (mensajes/notas/etiquetas) siguen exclusivamente en memoria — fuera del alcance
  de Fase 1, migrarán en una fase posterior.

Ninguna de estas limitaciones bloquea el avance del panel web — el resto se cierra cuando
`ENGINE_DRIVER=http` se active contra infraestructura real y cuando las conversaciones migren a
PostgreSQL en una fase futura.

## Criterios de aceptación de este ajuste (Fase 0 → soporte de dos modalidades)

- [x] La API inicia sin `DATABASE_URL`.
- [x] La API inicia sin `ENGINE_BASE_URL`.
- [x] `GET /health/live` responde `200` siempre.
- [x] `GET /health/ready` informa `persistence.driver: "memory"` / `engine.driver: "mock"`,
      ambos `"available"`, `mode: "development"`.
- [x] El frontend muestra el estado de modalidad simulada en la página de inicio.
- [x] Las pruebas pasan sin ningún servicio externo.
- [x] El código queda preparado para la integración real (Prisma + HttpEngineClient ya
      implementados, solo inactivos).

## Primer hito funcional (validado end-to-end)

1. El administrador (sembrado automáticamente) inicia sesión en `/login`.
2. `/dashboard` muestra su nombre, correo y el menú habilitado según sus permisos.
3. El administrador crea un nuevo ejecutivo desde `/dashboard/executives/new`, eligiendo su rol.
4. El nuevo ejecutivo aparece en `/dashboard/executives` y puede iniciar sesión de inmediato.
5. El administrador edita su nombre desde `/dashboard/executives/[id]/edit`.
6. El administrador lo desactiva: su próximo intento de login recibe `401` inmediatamente (sin
   reiniciar el proceso ni esperar a que expire ningún token). Al reactivarlo, vuelve a poder
   iniciar sesión.
7. El ejecutivo de prueba (sin `users.read`) inicia sesión y ve únicamente su subconjunto de
   permisos; si visita `/dashboard/executives` directamente, recibe un mensaje de acceso
   denegado en vez de la tabla — el backend rechaza la petición con `403`, la pantalla nunca
   llega a pedir datos que no debería mostrar.
8. El administrador registra una cuenta de correo (IMAP + SMTP) desde `/dashboard/mailboxes/new`;
   la respuesta nunca incluye la contraseña ni su forma cifrada, solo `credentialsConfigured: true`.
9. La edita sin reenviar la contraseña — se mantiene la ya guardada — y la desactiva/reactiva
   desde la lista.
10. El administrador presiona "Probar conexión" en una cuenta con correo
    `ventas+timeout@example.com`; el `MockEngineClient` responde de forma determinista con un
    error de timeout, la fila actualiza su pill de conexión a "Error de conexión" y la entrada
    queda visible en el historial de `/dashboard/mailboxes/[id]/edit`.
11. El administrador marca a un ejecutivo en la sección "Ejecutivos con acceso a esta cuenta" del
    edit de una cuenta y guarda; ese ejecutivo inicia sesión y ve la cuenta en
    `/dashboard/mailboxes/mine` — sin ningún dato de host/usuario IMAP-SMTP. El administrador
    desmarca al ejecutivo y guarda de nuevo: la cuenta desaparece de su vista inmediatamente,
    sin que el ejecutivo necesite volver a iniciar sesión — verificado con curl contra el BFF
    real (`/api/mailboxes/:id/assignees`, `/api/me/mailboxes`), no solo contra la API
    directamente.
12. El administrador crea una plantilla desde `/dashboard/templates/new` con asunto
    `Hola {{nombre}}, una idea para {{empresa}}`; mientras escribe, ve los chips
    `{{nombre}}`/`{{empresa}}` aparecer en vivo. Si escribe `{{1invalido}}`, ve el error en
    español al instante, antes de enviar nada al servidor.
13. Duplica esa plantilla — aparece una segunda con "(copia)" en el nombre y el mismo contenido,
    sin alterar la original. La archiva (desaparece del filtro "Activas", sigue en "Todos los
    estados") y la restaura. La elimina — deja de aparecer en la lista y de poder abrirse por id
    (`404`) — verificado con curl contra el BFF real (`/api/templates`), no solo contra la API
    directamente.
14. El administrador crea la variable `empresa` (origen "Contacto") desde
    `/dashboard/variables/new`. Vuelve a `/dashboard/templates/new`, hace clic en el campo
    "Cuerpo", escribe "Hola, te escribo de " y hace clic en el chip `{{empresa}}` del panel de
    variables: el texto queda exactamente como "Hola, te escribo de {{empresa}}", con el cursor
    después del token, listo para seguir escribiendo sin pisar nada — verificado con una prueba
    de inserción rápida (equivalente a un usuario escribiendo sin pausas) que expuso una
    condición de carrera real en el primer intento (la posición del cursor se reponía un frame
    tarde) y quedó corregida antes de reportar la fase como terminada.
15. El administrador crea la firma de una cuenta desde su edit ("Saludos, {{nombre}}") — queda
    activa de inmediato como versión 1. La edita ("Atentamente, {{nombre}}") — aparece la
    versión 2, activa, y la versión 1 sigue en el historial. Presiona "Vista previa": ve
    "Atentamente, Juan Pérez" sin ningún `{{...}}` visible, sin recargar la página. Presiona
    "Activar esta versión" sobre la versión 1: vuelve a ser la activa y el contenido del
    formulario se sincroniza solo, sin crear una versión 3. La archiva y la restaura sin que la
    versión activa cambie — verificado con curl contra el BFF real
    (`/api/mailboxes/:id/signature`, `.../preview`, `.../versions/:versionId/activate`), no solo
    contra la API directamente.
16. El administrador asigna esa cuenta al ejecutivo de prueba. El ejecutivo entra a
    `/dashboard/mailboxes/mine`, hace clic en "Ver firma" y ve el contenido de la versión activa
    de solo lectura, con un botón "Vista previa" — sin historial, sin poder editar, porque solo
    tiene `signatures.read`/`.preview`. Si intenta abrir la firma de una cuenta que no tiene
    asignada (cambiando el id en la URL), la página responde 404 antes de llamar a la API de
    firma — el chequeo de asignación vive en la página, no en el permiso.
17. Cerrar sesión invalida la cookie y el middleware vuelve a exigir login.
18. **(Fase 10)** El administrador abre el perfil del ejecutivo de prueba desde
    `/dashboard/executives`, va a la pestaña "Secuencias" y crea una secuencia nueva. En su
    página, selecciona como cuenta remitente la cuenta de ventas de demostración (asignada al
    ejecutivo, con conexión validada y firma activa). Agrega tres steps con asuntos y contenidos
    distintos entre sí. Vuelve a la secuencia y ve los tres listados en orden. Abre el primer step,
    presiona "Previsualizar con firma automática" y ve el HTML renderizado con la firma de la
    cuenta agregada al final, sin haberla elegido en ningún selector — el pill "Firma aplicada"
    confirma que se compuso. Escribe un correo de prueba y presiona "Enviar prueba": recibe el
    mensaje "aceptado por SMTP" del `MockEngineClient`. Vuelve al perfil del ejecutivo: la pestaña
    "Actividad" aparece vacía (todas las acciones anteriores las ejecutó el administrador, no el
    ejecutivo — ver "Limitación conocida" de la Fase 10), y la pestaña "Permisos" muestra las
    claves de permiso del rol `EXECUTIVE` — verificado con un script de Playwright contra la
    aplicación real (BFF incluido), no solo con tests automatizados. Quedan fuera de esta prueba,
    porque están fuera del alcance acordado para esta fase: activar la secuencia, programar un
    envío real, detectar una respuesta y detener steps siguientes — ninguno de esos tres tiene
    todavía un subsistema real que probar (prospectos, calendario, scheduler/worker, IMAP).
19. **(Autoservicio del ejecutivo)** El ejecutivo de prueba inicia sesión con su propia cuenta (no
    el admin) y ve "Secuencias" en el menú lateral — entra y ya ve ahí la secuencia de
    demostración sembrada para él. Crea una segunda secuencia propia, selecciona como remitente una
    de sus cuentas asignadas (el selector solo le ofrece esas, vía `/me/mailboxes`), agrega un step,
    lo previsualiza con firma automática y envía una prueba — sin que el administrador intervenga en
    ningún paso. Vuelve a "Mis cuentas de correo" y presiona "Ver bandeja" en una cuenta asignada:
    ve la lista de conversaciones de demostración y abre una para leer sus mensajes. Verificado con
    un script de Playwright contra la aplicación real, con la sesión del ejecutivo de principio a
    fin.

## Siguiente fase

Con la Fase 10 (secuencia + steps + editor + firma automática + perfil de ejecutivo) sumada a lo
anterior, los frentes concretos pendientes de acordar con el usuario son:

1. **Prospectos/contactos** (`Contact`/`ContactList`, importación CSV/Excel) — sin esto,
   `{{contact.*}}` seguirá resolviendo solo a datos de ejemplo.
2. **Calendario de envío real** (`SequenceSchedule`) y el **scheduler/worker** que consuma una
   secuencia activa — son la base para que un estado `ACTIVE` signifique algo real.
3. **Sincronización IMAP, detección de respuesta/rebote/baja y detener steps siguientes** — el
   flujo que el usuario pidió validar completo en esta fase, pero que depende de los dos puntos
   anteriores.
4. **Hilos MIME reales** para `StepSendMode.REPLY`, y **adjuntos** (`StepAttachment`).

Pendiente también desde la Fase 9, sin relación con secuencias: **el wizard guiado de 7 pasos**
para crear una cuenta de correo (`Datos → IMAP → SMTP → Validación → Firma → Ejecutivos →
Resumen`, con `Mailbox.setupStatus` y reanudación de una configuración incompleta) — el backend de
firma/asignación ya quedó listo para que lo consuma sin cambios adicionales; falta solo la UI de
pasos.

Más allá de todo eso, sigue pendiente la integración real con Hetzner + el motor
(`ENGINE_DRIVER=http`, `PERSISTENCE_DRIVER=postgres`, `STORAGE_DRIVER=s3`) contra la
infraestructura que hoy solo existe simulada.
