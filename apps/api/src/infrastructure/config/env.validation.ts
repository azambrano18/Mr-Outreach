import * as Joi from 'joi';

/**
 * Single source of truth for which environment variables exist and when
 * each is actually required. DATABASE_URL is only required when
 * PERSISTENCE_DRIVER=postgres; ENGINE_BASE_URL only when ENGINE_DRIVER=http.
 * Nest refuses to boot if this schema fails — see app.module.ts.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  // Railway's `npm run start:prod` always sets NODE_ENV=production — that
  // is Node/Nest's technical execution mode (enables production
  // optimizations), not a statement about which real environment this is.
  // Railway staging runs with NODE_ENV=production too, so any check that
  // used NODE_ENV to gate a production-only restriction (see the incident
  // this variable fixes, below) would incorrectly also block staging.
  // APP_ENV is the explicit, application-controlled signal for which real
  // environment this is; it never gets a platform-imposed value the way
  // NODE_ENV does. Defaults to NODE_ENV's value only so existing
  // deployments that haven't set APP_ENV yet keep their exact prior
  // behavior (never a silent weakening of production's own protection) —
  // every environment should still set APP_ENV explicitly going forward
  // (see docs/environment-variables.md).
  APP_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default(Joi.ref('NODE_ENV')),
  PORT: Joi.number().default(3001),
  WEB_ORIGIN: Joi.string().uri().default('http://localhost:3000'),

  PERSISTENCE_DRIVER: Joi.string().valid('memory', 'postgres').default('memory'),
  ENGINE_DRIVER: Joi.string().valid('mock', 'http').default('mock'),
  MAIL_ENGINE_MODE: Joi.string().valid('simulation', 'remote').default('simulation'),
  MAILBOX_MOTOR_DRIVER: Joi.string().valid('simulated', 'http').default('simulated'),
  STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
  API_PUBLIC_URL: Joi.string().uri().optional(),

  // TLS and other connection tuning for the Postgres driver are expressed
  // as DATABASE_URL query parameters (Prisma convention, e.g.
  // "?sslmode=require"), not as separate env vars — Prisma owns the
  // connection now that real models exist, replacing the temporary `pg`
  // pool from Phase 0.
  DATABASE_URL: Joi.string().when('PERSISTENCE_DRIVER', {
    is: 'postgres',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),

  // Only consulted by `prisma migrate`/`prisma db` (schema.prisma's
  // datasource.directUrl) — the running app/PrismaClient never reads this,
  // and `prisma generate` tolerates it being empty too (verified). It only
  // needs to be a real, non-empty value in whichever shell/.env actually
  // runs a `prisma migrate` command against Postgres.
  DIRECT_URL: Joi.string().allow('').optional(),

  ENGINE_BASE_URL: Joi.string().when('ENGINE_DRIVER', {
    is: 'http',
    then: Joi.string().uri().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  ENGINE_API_KEY: Joi.string().allow('').optional(),

  // Fase 2.1 §17 — the motor API key must be a real, non-empty value at
  // startup when MAILBOX_MOTOR_DRIVER=http; in simulated mode (the only
  // mode implemented so far) no real key is required.
  MAILBOX_MOTOR_BASE_URL: Joi.string().when('MAILBOX_MOTOR_DRIVER', {
    is: 'http',
    then: Joi.string().uri().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  MAILBOX_MOTOR_API_KEY: Joi.string().when('MAILBOX_MOTOR_DRIVER', {
    is: 'http',
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  MAILBOX_MOTOR_TIMEOUT_MS: Joi.number().default(10_000),

  // Consolidación contractual §8 — gates SequenceTemplateMotorPort/
  // SequenceExecutionMotorPort (Plantilla publish + Gestión start), a THIRD
  // external system distinct from both MAILBOX_MOTOR_* (account linking)
  // and MAIL_ENGINE_MODE (the legacy simulated sequence engine). Same
  // fail-closed shape as MAILBOX_MOTOR_*: URL/API key only required once
  // SEQUENCE_MOTOR_MODE=http.
  SEQUENCE_MOTOR_MODE: Joi.string().valid('simulated', 'http').default('simulated'),
  SEQUENCE_MOTOR_BASE_URL: Joi.string().when('SEQUENCE_MOTOR_MODE', {
    is: 'http',
    then: Joi.string().uri().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  SEQUENCE_MOTOR_API_KEY: Joi.string().when('SEQUENCE_MOTOR_MODE', {
    is: 'http',
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  SEQUENCE_MOTOR_TIMEOUT_MS: Joi.number().default(10_000),

  // Fase "Recepción de eventos del motor" — authenticates inbound
  // POST /integration/events calls. Deliberately NOT required at boot
  // (Joi.required() would make every environment, including ones that never
  // enable this endpoint, fail to start) — MotorEventModule itself refuses
  // to accept any event when MOTOR_EVENT_HMAC_SECRET is empty, fail-closed,
  // in every environment (never just production). Only 'hmac' is
  // implemented today; the variable is kept open for a future mode.
  MOTOR_EVENT_AUTH_MODE: Joi.string().valid('hmac').default('hmac'),
  MOTOR_EVENT_HMAC_SECRET: Joi.string().allow('').optional(),
  MOTOR_EVENT_MAX_CLOCK_SKEW_SECONDS: Joi.number().default(300),

  // Fase Firma — gates SignatureAssetStoragePort (images embedded in a
  // Plantilla's signature). Independent of STORAGE_DRIVER (the older,
  // generic rich-text image port): when SIGNATURE_ASSET_STORAGE_MODE=r2,
  // every R2_* variable below becomes required so the API refuses to boot
  // with an incomplete Cloudflare R2 configuration.
  SIGNATURE_ASSET_STORAGE_MODE: Joi.string().valid('simulated', 'r2').default('simulated'),
  R2_ACCOUNT_ID: Joi.string().when('SIGNATURE_ASSET_STORAGE_MODE', {
    is: 'r2',
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  R2_ACCESS_KEY_ID: Joi.string().when('SIGNATURE_ASSET_STORAGE_MODE', {
    is: 'r2',
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  R2_SECRET_ACCESS_KEY: Joi.string().when('SIGNATURE_ASSET_STORAGE_MODE', {
    is: 'r2',
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  R2_BUCKET_NAME: Joi.string().when('SIGNATURE_ASSET_STORAGE_MODE', {
    is: 'r2',
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  // Required in every mode (not just r2): the simulated adapter's dev URLs
  // are built from API_PUBLIC_URL instead, but the sanitizer always needs a
  // real value here to know which host an <img src> is allowed to point at.
  // In `r2` mode this must be HTTPS and never the Cloudflare-issued
  // `*.r2.dev` fallback domain — production/staging always use a custom
  // domain (see docs/signature-assets-r2-setup.md).
  R2_PUBLIC_BASE_URL: Joi.string()
    .uri()
    .default('https://assets.mejoreferido.com')
    .when('SIGNATURE_ASSET_STORAGE_MODE', {
      is: 'r2',
      then: Joi.string()
        .uri({ scheme: ['https'] })
        .custom((value: string, helpers) => {
          if (/\br2\.dev\b/i.test(value)) {
            return helpers.error('any.invalid');
          }
          return value;
        }, 'reject r2.dev fallback domain')
        .required(),
    }),
  // Safe path segment only — no leading/trailing slash, no "..", no spaces.
  R2_SIGNATURE_PREFIX: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/)
    .default('firmas'),
  // Fase 2 (R2), §7 — a separate prefix for email-body images, never mixed with R2_SIGNATURE_PREFIX.
  R2_EMAIL_BODY_PREFIX: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/)
    .default('email-body'),

  AUTH_SECRET: Joi.string().min(16).required(),

  // Must decode to exactly 32 bytes (AES-256) — see SecretEncryptionService.
  // Generate one with: openssl rand -base64 32
  CREDENTIALS_ENCRYPTION_KEY: Joi.string()
    .base64()
    .custom((value: string, helpers) => {
      if (Buffer.from(value, 'base64').length !== 32) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'AES-256 key length check')
    .required(),

  DEV_ADMIN_EMAIL: Joi.string()
    .email({ tlds: { allow: false } }) // ".test" is a valid reserved TLD (RFC 2606) but not in Joi's public suffix list
    .default('admin@local.test'),
  DEV_ADMIN_PASSWORD: Joi.string()
    .min(8)
    .when('PERSISTENCE_DRIVER', {
      is: 'memory',
      then: Joi.string().min(8).required(),
      otherwise: Joi.string().allow('').optional(),
    }),
  DEV_EXECUTIVE_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .default('ejecutivo@local.test'),
  DEV_EXECUTIVE_PASSWORD: Joi.string()
    .min(8)
    .when('PERSISTENCE_DRIVER', {
      is: 'memory',
      then: Joi.string().min(8).required(),
      otherwise: Joi.string().allow('').optional(),
    }),
}).custom((value, helpers) => {
  // Fase 11 — the simulated mailbox motor adapter is a dev/staging-only
  // tool: it's a plain in-memory Map reset by every process restart, and
  // its "Desvinculación en proceso" recovery only ever works because its
  // fixtures were issued by the same in-process simulator — a real motor
  // would never behave this way. Cross-field checks like this one can't
  // be expressed with `Joi.string().when(...)` chained onto a schema that
  // already has `.valid()`/`.default()`: Joi concatenates (unions) the
  // conditional branch with the base schema instead of replacing it,
  // which would silently keep 'simulated' allowed in production. A
  // `.custom()` on the whole object is the reliable way to fail closed
  // here, including when the variable is left unset entirely (the
  // default must never silently resolve to 'simulated' in production).
  //
  // Deliberately keyed on APP_ENV, never NODE_ENV: Railway staging runs
  // with NODE_ENV=production (that's just Node's execution mode, forced
  // by `npm run start:prod`), so a NODE_ENV-based check here would
  // incorrectly refuse to boot staging too — see the incident this
  // variable fixes.
  if (value.APP_ENV === 'production' && value.MAILBOX_MOTOR_DRIVER !== 'http') {
    return helpers.message({
      custom: 'MAILBOX_MOTOR_DRIVER must be "http" when APP_ENV=production — the simulated adapter must never run in the real production environment.',
    });
  }
  return value;
}, 'production requires the http mailbox motor driver');
