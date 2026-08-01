/**
 * Dedicated Jest config for one-off admin scripts under `prisma/` (e.g.
 * `bootstrap-admin.ts`, `sync-system-roles.ts`) — these are NOT part of the
 * `apps/api` Nest application (whose own Jest config has `rootDir: "src"`
 * and therefore cannot see anything outside `apps/api/src`). Uses
 * `ts-jest`, already hoisted to the repo root by npm workspaces — no new
 * dependency added.
 *
 * Run with: npm run test:prisma-scripts (see root package.json).
 */
module.exports = {
  rootDir: 'prisma',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
