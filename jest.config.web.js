/**
 * Dedicated Jest config for pure-logic (.spec.ts, no JSX/DOM) modules under
 * apps/web/lib — apps/web itself has no test runner (Next.js only ships
 * `next lint`/`next build`), and setting up a full component-testing stack
 * (jsdom + React Testing Library) is out of scope for testing plain
 * TypeScript functions like admin-navigation's route-matching logic. Mirrors
 * the same pattern already used for prisma/ scripts (jest.config.prisma.js).
 *
 * Run with: npm run test:web-lib (see root package.json).
 */
module.exports = {
  rootDir: 'apps/web',
  testEnvironment: 'node',
  testRegex: 'lib/.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
};
