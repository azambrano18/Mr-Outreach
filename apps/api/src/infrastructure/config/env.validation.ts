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
    .default('signatures'),

  // External, read-only Neon CRM database (table maestro_clientes) — a
  // wholly separate driver from PERSISTENCE_DRIVER, since it's a different
  // database Mr Outreach doesn't own.
  CRM_DRIVER: Joi.string().valid('mock', 'postgres').default('mock'),
  CRM_DATABASE_URL: Joi.string().when('CRM_DRIVER', {
    is: 'postgres',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  CRM_ACTIVE_STATUS_VALUE: Joi.string().allow('').optional(),

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
});
