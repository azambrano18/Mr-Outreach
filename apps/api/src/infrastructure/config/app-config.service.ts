import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PersistenceDriver = 'memory' | 'postgres';
export type EngineDriver = 'mock' | 'http';
export type StorageDriver = 'local' | 's3';
/** Fase Firma — gates `SignatureAssetStoragePort` (signature-embedded images), independent of `StorageDriver` above (the older, generic rich-text image port). */
export type SignatureAssetStorageMode = 'simulated' | 'r2';
/**
 * Independent of `PersistenceDriver`: the app's own database can be
 * memory/postgres while the CRM read is separately mock/postgres, since
 * they're two entirely different databases (Mr Outreach's own vs Neon's
 * external, read-only `maestro_clientes`) — see AdminReorg plan Etapa 4.
 */
export type CrmDriver = 'mock' | 'postgres';
/**
 * Separate from `EngineDriver` on purpose — `EngineDriver` gates the older
 * synchronous EngineClient port (test connection / send test / read inbox
 * on demand). `MailEngineMode` gates the newer async command/event
 * integration layer (MailEnginePort — provisioning, sequence publish,
 * imports, scheduled sends, inbound replies). Both ports coexist; see
 * README > "Fase 12" for why neither replaces the other yet.
 */
export type MailEngineMode = 'simulation' | 'remote';

/**
 * Fase 2.1 — gates `MailboxMotorPort` (token-based account linking), a
 * separate external system from `MailEnginePort`/`EngineClient` above: the
 * "motor" here owns account registration/credentials/token issuance, never
 * sending. `http` is a prepared-but-unimplemented driver (see
 * HttpMailboxMotorAdapter) — no real motor is reachable yet.
 */
export type MailboxMotorDriver = 'simulated' | 'http';

/**
 * Gates `SequenceTemplateMotorPort`/`SequenceExecutionMotorPort` — the
 * Railway-hosted engine that accepts a published Plantilla and starts a
 * Gestión. A third external system, distinct from both `MailboxMotorPort`
 * (account linking) and `MailEnginePort` (the legacy simulated sequence
 * engine): this one owns template publication receipts (`templateToken`)
 * and execution receipts (`executionToken`/`serverExecutionId`).
 */
export type SequenceMotorMode = 'simulated' | 'http';

/**
 * The one place in the app that reads PERSISTENCE_DRIVER / ENGINE_DRIVER
 * and related settings. Modules ask this service which adapter to use;
 * nothing else should call `configService.get('PERSISTENCE_DRIVER')`
 * directly, so the driver switch stays centralized.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }

  get port(): number {
    return this.config.get<number>('PORT', 3001);
  }

  get webOrigin(): string {
    return this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
  }

  get persistenceDriver(): PersistenceDriver {
    return this.config.get<PersistenceDriver>('PERSISTENCE_DRIVER', 'memory');
  }

  get engineDriver(): EngineDriver {
    return this.config.get<EngineDriver>('ENGINE_DRIVER', 'mock');
  }

  get mailEngineMode(): MailEngineMode {
    return this.config.get<MailEngineMode>('MAIL_ENGINE_MODE', 'simulation');
  }

  get mailboxMotorDriver(): MailboxMotorDriver {
    return this.config.get<MailboxMotorDriver>('MAILBOX_MOTOR_DRIVER', 'simulated');
  }

  get mailboxMotorBaseUrl(): string | undefined {
    return this.config.get<string>('MAILBOX_MOTOR_BASE_URL') || undefined;
  }

  get mailboxMotorApiKey(): string | undefined {
    return this.config.get<string>('MAILBOX_MOTOR_API_KEY') || undefined;
  }

  get mailboxMotorTimeoutMs(): number {
    return this.config.get<number>('MAILBOX_MOTOR_TIMEOUT_MS', 10_000);
  }

  get sequenceMotorMode(): SequenceMotorMode {
    return this.config.get<SequenceMotorMode>('SEQUENCE_MOTOR_MODE', 'simulated');
  }

  get sequenceMotorBaseUrl(): string | undefined {
    return this.config.get<string>('SEQUENCE_MOTOR_BASE_URL') || undefined;
  }

  get sequenceMotorApiKey(): string | undefined {
    return this.config.get<string>('SEQUENCE_MOTOR_API_KEY') || undefined;
  }

  get sequenceMotorTimeoutMs(): number {
    return this.config.get<number>('SEQUENCE_MOTOR_TIMEOUT_MS', 10_000);
  }

  get storageDriver(): StorageDriver {
    return this.config.get<StorageDriver>('STORAGE_DRIVER', 'local');
  }

  /** Base URL this process is reachable at — used to build public image URLs. */
  get apiPublicUrl(): string {
    return this.config.get<string>('API_PUBLIC_URL', `http://localhost:${this.port}`);
  }

  get signatureAssetStorageMode(): SignatureAssetStorageMode {
    return this.config.get<SignatureAssetStorageMode>('SIGNATURE_ASSET_STORAGE_MODE', 'simulated');
  }

  get r2AccountId(): string | undefined {
    return this.config.get<string>('R2_ACCOUNT_ID') || undefined;
  }

  get r2AccessKeyId(): string | undefined {
    return this.config.get<string>('R2_ACCESS_KEY_ID') || undefined;
  }

  get r2SecretAccessKey(): string | undefined {
    return this.config.get<string>('R2_SECRET_ACCESS_KEY') || undefined;
  }

  get r2BucketName(): string | undefined {
    return this.config.get<string>('R2_BUCKET_NAME') || undefined;
  }

  get r2PublicBaseUrl(): string {
    return this.config.get<string>('R2_PUBLIC_BASE_URL', 'https://assets.mejoreferido.com');
  }

  get r2SignaturePrefix(): string {
    return this.config.get<string>('R2_SIGNATURE_PREFIX', 'signatures');
  }

  /** The one host a signature's `<img src>` is ever allowed to point at — see HtmlSanitizerService.sanitizeSignatureHtml. */
  get signatureAssetAllowedImageHost(): string {
    const base = this.signatureAssetStorageMode === 'r2' ? this.r2PublicBaseUrl : this.apiPublicUrl;
    return new URL(base).hostname;
  }

  /** True only in `simulated` mode — the dev/test adapter serves over plain HTTP on localhost; the real R2 host must always be HTTPS. */
  get signatureAssetAllowInsecureImageHost(): boolean {
    return this.signatureAssetStorageMode === 'simulated';
  }

  get isIntegratedMode(): boolean {
    return this.persistenceDriver === 'postgres' && this.engineDriver === 'http';
  }

  /**
   * Not read directly by app code: Prisma resolves DATABASE_URL from the
   * process environment itself (see prisma/schema.prisma's
   * `url = env("DATABASE_URL")`). Exposed here only for diagnostics
   * (e.g. logging that a URL is present without ever logging its value).
   */
  get hasDatabaseUrl(): boolean {
    return Boolean(this.config.get<string>('DATABASE_URL'));
  }

  get engineBaseUrl(): string | undefined {
    return this.config.get<string>('ENGINE_BASE_URL') || undefined;
  }

  get engineApiKey(): string | undefined {
    return this.config.get<string>('ENGINE_API_KEY') || undefined;
  }

  get authSecret(): string {
    return this.config.getOrThrow<string>('AUTH_SECRET');
  }

  get credentialsEncryptionKey(): string {
    return this.config.getOrThrow<string>('CREDENTIALS_ENCRYPTION_KEY');
  }

  get devAdminEmail(): string {
    return this.config.get<string>('DEV_ADMIN_EMAIL', 'admin@local.test');
  }

  get devAdminPassword(): string | undefined {
    return this.config.get<string>('DEV_ADMIN_PASSWORD') || undefined;
  }

  get devExecutiveEmail(): string {
    return this.config.get<string>('DEV_EXECUTIVE_EMAIL', 'ejecutivo@local.test');
  }

  get devExecutivePassword(): string | undefined {
    return this.config.get<string>('DEV_EXECUTIVE_PASSWORD') || undefined;
  }

  get crmDriver(): CrmDriver {
    return this.config.get<CrmDriver>('CRM_DRIVER', 'mock');
  }

  /** Diagnostics only, mirrors hasDatabaseUrl — the Postgres pool reads CRM_DATABASE_URL directly. */
  get hasCrmDatabaseUrl(): boolean {
    return Boolean(this.config.get<string>('CRM_DATABASE_URL'));
  }

  get crmDatabaseUrl(): string {
    return this.config.getOrThrow<string>('CRM_DATABASE_URL');
  }

  /**
   * The real stored value confirmed via introspection is "ACTIVO" — kept
   * configurable (not hardcoded) so it can be corrected without a redeploy
   * if the CRM's data ever changes shape.
   */
  get crmActiveStatusValue(): string {
    return this.config.get<string>('CRM_ACTIVE_STATUS_VALUE', 'ACTIVO');
  }
}
