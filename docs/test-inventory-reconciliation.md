# Reconciliación del inventario de pruebas — release candidate

Todos los comandos de esta tabla son reproducibles tal cual están escritos,
desde `apps/api/`, contra el commit `6efa794` (tope de
`release/mr-outreach-production-readiness` al momento de esta
reconciliación).

| Suite | Comando | Archivos | Pruebas descubiertas | Ejecutadas | Omitidas | Resultado |
|---|---|---:|---:|---:|---:|---|
| Unitarias (driver memory) | `npx jest` | 94 de 119 | 895 | 895 | 0 | ✅ 895/895 |
| Contract + integración (dentro del mismo comando, sin `TEST_DATABASE_URL`) | `npx jest` (mismo comando de arriba) | 25 de 119 | 166 | 0 | 166 | ⏭️ omitidas por diseño — cada archivo empieza con `const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip` |
| Contract + integración contra PostgreSQL real (`test`) | `TEST_DATABASE_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=test PERSISTENCE_DRIVER=postgres npx jest --runInBand --testPathPattern="prisma-.*\.contract\.spec\.ts$\|restart-durability\|\.integration\.spec\.ts$"` (= `npm run test:integration`) | 25 | 166 | 166 | 0 | ✅ 166/166 contra `mr-outreach-test` |
| Contract + integración contra PostgreSQL real (`development`) | Mismo comando de arriba, apuntado a `mr-outreach-development` | 25 | 166 | 166 | 0 | ✅ 166/166 contra `mr-outreach-development` (verificado tras la limpieza de fixtures sintéticos de la fase anterior) |
| E2E (Jest + Supertest, driver memory) | `npx jest --config test/jest-e2e.json` | 23 | 221 | 221 | 0 | ✅ 221/221 |
| Playwright | — | 0 | 0 | 0 | 0 | **No configurado** — no existe ningún archivo de configuración de Playwright en este repositorio. No se declara como aprobado ni como pendiente de arreglar; simplemente no existe |

**No se suman estas filas entre sí como "un solo total"** — las 166
pruebas de "contract + integración" son **las mismas pruebas** ejecutadas
tres veces (una vez omitidas por defecto, una vez contra `test`, una vez
contra `development|`), no 498 pruebas distintas. El total de pruebas
**distintas** que existen en el repositorio es 895 (unitarias) + 166
(contract/integración) + 221 (E2E) = **1282 pruebas de código distinto**,
de las cuales las 166 de contract/integración se ejecutan en 3 contextos
diferentes como evidencia de que test y development se comportan igual.

## Por qué cambió el conteo entre informes anteriores (796 → 888 → 895)

Cada fase de este proyecto agregó código y, con él, sus propias pruebas —
el conteo total sube porque el número de archivos `*.spec.ts` sube, no
porque algo se haya duplicado ni inflado artificialmente:

- **796** (mencionado en un informe anterior a este documento): snapshot
  de una fase previa a "Recepción de eventos del motor" — no se pudo
  reconstruir su desglose exacto suite-por-suite dentro de esta
  reconciliación sin reescribir el entorno histórico completo (se intentó
  reconstruir contra el commit `e3a3fee` en un worktree temporal, pero el
  entorno de workspaces de npm de esa antigüedad requeriría reinstalar
  dependencias de una forma que excede el alcance de "no cambios
  funcionales" de esta fase). Se documenta la imposibilidad de
  reconstruirlo en vez de inventar una cifra.
- **820 pasadas / 967 totales** (147 omitidas, 88 de 111 suites
  ejecutadas): snapshot intermedio durante la fase "Recepción de eventos
  del motor", tomado **antes** de escribir las pruebas unitarias propias
  de esa fase (Fases 0-12 de esa fase ya tenían código de producción,
  pero su Fase 14 de pruebas todavía no se había escrito).
- **888 pasadas / 1042 totales** (154 omitidas, 93 de 117 suites): al
  cierre de la fase "Recepción de eventos del motor", tras agregar 5
  archivos de pruebas unitarias nuevos (HMAC, validador de payload,
  proyector, caso de uso de procesamiento, caso de uso de reintento — 68
  pruebas) más 1 archivo de integración real y 1 de E2E (ambos contados
  como "omitidos" en el conteo por defecto, ya que requieren
  `TEST_DATABASE_URL`).
- **895 pasadas / 1061 totales** (166 omitidas, 94 de 119 suites): al
  cierre de la fase "Estado leído/no leído por usuario", tras agregar
  `conversation-unread.policy.spec.ts` (7 pruebas unitarias nuevas) y 2
  archivos más de integración/E2E (omitidos en el conteo por defecto,
  contados en las filas de `test`/`development`/E2E de esta tabla).

La progresión 967 → 1042 → 1061 (conteo TOTAL, pasadas+omitidas) es
enteramente explicable por archivos de prueba nuevos sumados en cada
fase — nunca por una prueba que empezó a fallar y se ocultó, ni por un
recuento inflado.

## Criterio de aceptación de esta reconciliación

- ✅ 0 pruebas aplicables fallidas (todas las filas "Ejecutadas" de la
  tabla están en verde).
- ✅ Toda prueba omitida está justificada (la única categoría "omitida"
  es el guard `describeIfDatabaseAvailable`, documentado en cada archivo,
  y se demuestra ejecutada en las 2 filas siguientes de la tabla).
- ✅ Ningún test se omite silenciosamente — cada suite con
  `describe.skip` lo hace de forma explícita y condicional a una variable
  de entorno documentada, nunca por un `.skip`/`.only` residual dejado
  por error (verificado: `git grep -n "\.skip(\|\.only("` no encuentra
  ningún `.only` en el repositorio, y todo `.skip` proviene del mismo
  patrón `describeIfDatabaseAvailable`).
- ✅ Comandos reproducibles — cada celda de "Comando" en la tabla es
  ejecutable tal cual.
- ✅ Test y development aislados correctamente — cada ambiente usa su
  propia `TEST_DATABASE_URL`/`DATABASE_URL`, nunca comparten conexión, y
  ambos dieron el mismo resultado (166/166) de forma independiente.
