#!/usr/bin/env node
/**
 * Non-destructive production preflight check — Fase "Preparación formal
 * para producción". Reads process.env and local migration files only; the
 * only network call it makes (if DATABASE_URL is set) is a single
 * read-only `SELECT 1`, never a write, never a migration command.
 *
 * Intended to run as a manual step (or a CI job) right before following
 * docs/production-deployment-runbook.md — never as part of this
 * repository's own test suite, and never automatically against a real
 * environment without a human deciding to run it.
 *
 * Exit code 0 = no blocking findings. Exit code 1 = at least one blocking
 * finding (printed to stderr). Warnings never fail the script — they are
 * printed for a human to judge, since some are legitimately fine outside
 * of `NODE_ENV=production`.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Kept in sync with docs/migrations-inventory.md — update both together. */
const EXPECTED_MIGRATION_HASHES = {
  '20260730000000_init_mr_outreach': '529ec38fee85dd0857a300ef75f9bec7f86c26175dbfed791133aa1f725731f6',
  '20260730000001_restore_case_insensitive_unique_indexes': '5eb0a3cc8f61119abc114c3dc84769c3cba8fba3b296e49548372bf66e83bff0',
  '20260731000000_persist_conversations_and_active_flow_attribution': 'ad2bd7b9c8d6953967e0dadd5b5a8c911d285ae9e88391eb673b9efe142cb98f',
  '20260731145609_motor_event_ingestion': '4e9e77ee0e8bb991e0e8d968eb01fd204abff86526a6b8645dfe4792c3637701',
};

const findings = { blocking: [], warnings: [] };

function block(message) {
  findings.blocking.push(message);
}
function warn(message) {
  findings.warnings.push(message);
}

function checkRequiredEnv(name, { minLength } = {}) {
  const value = process.env[name];
  if (!value) {
    block(`${name} no está definida.`);
    return;
  }
  if (minLength && value.length < minLength) {
    block(`${name} está definida pero es más corta que el mínimo esperado (${minLength} caracteres).`);
  }
}

function checkAbsentInProduction(name) {
  if (process.env.NODE_ENV === 'production' && process.env[name]) {
    block(`${name} está definida en un ambiente NODE_ENV=production — nunca debe existir ahí.`);
  }
}

function runEnvChecks() {
  checkRequiredEnv('NODE_ENV');
  if (process.env.NODE_ENV !== 'production') {
    warn(`NODE_ENV=${process.env.NODE_ENV || '(vacío)'} — este script asume que se ejecuta como preflight de producción; algunos hallazgos "bloqueantes" abajo son normales fuera de producción.`);
  }

  checkRequiredEnv('PERSISTENCE_DRIVER');
  if (process.env.PERSISTENCE_DRIVER !== 'postgres' && process.env.NODE_ENV === 'production') {
    block('PERSISTENCE_DRIVER debe ser "postgres" en producción — nunca "memory".');
  }

  if (process.env.PERSISTENCE_DRIVER === 'postgres') {
    checkRequiredEnv('DATABASE_URL');
  }

  checkRequiredEnv('AUTH_SECRET', { minLength: 16 });
  checkRequiredEnv('CREDENTIALS_ENCRYPTION_KEY');
  if (process.env.CREDENTIALS_ENCRYPTION_KEY) {
    try {
      const decoded = Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY, 'base64');
      if (decoded.length !== 32) {
        block('CREDENTIALS_ENCRYPTION_KEY no decodifica a exactamente 32 bytes (AES-256).');
      }
    } catch {
      block('CREDENTIALS_ENCRYPTION_KEY no es base64 válido.');
    }
  }

  checkRequiredEnv('WEB_ORIGIN');
  if (process.env.NODE_ENV === 'production' && process.env.WEB_ORIGIN && /localhost|127\.0\.0\.1/.test(process.env.WEB_ORIGIN)) {
    block('WEB_ORIGIN apunta a localhost en un ambiente de producción.');
  }

  if (!process.env.MOTOR_EVENT_HMAC_SECRET) {
    warn('MOTOR_EVENT_HMAC_SECRET vacío — POST /integration/events responderá 404 (fail-closed, esperado si el motor real todavía no está conectado).');
  }

  if (process.env.SIGNATURE_ASSET_STORAGE_MODE === 'r2') {
    for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
      checkRequiredEnv(name);
    }
    if (process.env.R2_PUBLIC_BASE_URL && /r2\.dev/i.test(process.env.R2_PUBLIC_BASE_URL)) {
      block('R2_PUBLIC_BASE_URL usa el dominio de fallback *.r2.dev — producción debe usar un dominio propio.');
    }
  }

  checkAbsentInProduction('DEV_ADMIN_EMAIL');
  checkAbsentInProduction('DEV_ADMIN_PASSWORD');
  checkAbsentInProduction('DEV_EXECUTIVE_EMAIL');
  checkAbsentInProduction('DEV_EXECUTIVE_PASSWORD');
}

function runMigrationChecksumChecks() {
  const migrationsDir = path.join(REPO_ROOT, 'prisma', 'migrations');
  for (const [name, expectedHash] of Object.entries(EXPECTED_MIGRATION_HASHES)) {
    const filePath = path.join(migrationsDir, name, 'migration.sql');
    if (!fs.existsSync(filePath)) {
      block(`Falta el archivo de migración esperado: ${name}/migration.sql`);
      continue;
    }
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    if (actualHash !== expectedHash) {
      block(`El hash de ${name}/migration.sql no coincide con docs/migrations-inventory.md — el archivo fue modificado después de aplicarse en test/development. Esperado ${expectedHash}, obtenido ${actualHash}.`);
    }
  }
}

async function runReadOnlyDatabasePing() {
  if (!process.env.DATABASE_URL) {
    warn('DATABASE_URL no está definida — se omite el ping de solo lectura a la base de datos.');
    return;
  }
  try {
    // eslint-disable-next-line global-require
    const { PrismaClient } = require(path.join(REPO_ROOT, 'node_modules', '@prisma', 'client'));
    const prisma = new PrismaClient();
    await prisma.$queryRawUnsafe('SELECT 1');
    await prisma.$disconnect();
  } catch (error) {
    block(`No se pudo conectar a DATABASE_URL en modo solo lectura (SELECT 1): ${error.message}`);
  }
}

async function main() {
  runEnvChecks();
  runMigrationChecksumChecks();
  await runReadOnlyDatabasePing();

  if (findings.warnings.length > 0) {
    console.log('\n=== Advertencias (no bloquean, revisar igual) ===');
    findings.warnings.forEach((w) => console.log(`  - ${w}`));
  }
  if (findings.blocking.length > 0) {
    console.error('\n=== Hallazgos bloqueantes ===');
    findings.blocking.forEach((b) => console.error(`  - ${b}`));
    console.error(`\n${findings.blocking.length} hallazgo(s) bloqueante(s). No continuar con el despliegue hasta resolverlos.`);
    process.exit(1);
  }
  console.log('\nSin hallazgos bloqueantes.');
  process.exit(0);
}

main().catch((error) => {
  console.error('El preflight check falló de forma inesperada:', error);
  process.exit(1);
});
