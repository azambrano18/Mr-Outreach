/**
 * Fase "Recepción de eventos del motor" — authenticates an inbound
 * `POST /integration/events` call before its body is ever parsed as an
 * event envelope. Verifies the raw, unparsed body (so a signature computed
 * over the exact bytes the motor sent can be checked byte-for-byte) plus a
 * timestamp header, rejecting anything outside the configured clock-skew
 * tolerance — replay protection beyond the timestamp window itself is the
 * downstream eventId+origin uniqueness constraint on `IntegrationEvent`,
 * not this port's job.
 *
 * The rest of the application depends on this port, never on a concrete
 * adapter directly — same rule as every other motor port in this codebase
 * (MailboxMotorPort, SequenceTemplateMotorPort, SequenceExecutionMotorPort).
 */
export interface MotorEventAuthInput {
  /** The exact, unparsed request body bytes (as a UTF-8 string) — never the re-serialized JSON, which could differ byte-for-byte from what was signed. */
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
}

export type MotorEventAuthFailureReason =
  | 'MISSING_SIGNATURE'
  | 'MISSING_TIMESTAMP'
  | 'INVALID_TIMESTAMP'
  | 'TIMESTAMP_OUT_OF_TOLERANCE'
  | 'INVALID_SIGNATURE'
  | 'NOT_CONFIGURED';

export interface MotorEventAuthResult {
  authenticated: boolean;
  /** Internal-only classification for logging/metrics — never rendered verbatim in the HTTP response. */
  failureReason?: MotorEventAuthFailureReason;
}

export const MOTOR_EVENT_AUTHENTICATOR = Symbol('MOTOR_EVENT_AUTHENTICATOR');

export interface MotorEventAuthenticator {
  verify(input: MotorEventAuthInput): MotorEventAuthResult;
  /** Whether this authenticator is actually usable right now (e.g. a secret is configured) — checked before the guard even attempts verify(), so a missing configuration 404s the whole endpoint instead of silently accepting or always-rejecting every event. */
  isConfigured(): boolean;
}
