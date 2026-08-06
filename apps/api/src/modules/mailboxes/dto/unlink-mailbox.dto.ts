import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Fase 2.1, §14 — never deletes the account; only blocks new activity going forward. */
export class UnlinkMailboxDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  correlationId?: string;

  /**
   * §1/§3 — explicit admin authorization to remove this mailbox's
   * MailboxAssignment rows once REVOKED is confirmed. The frontend's
   * confirmation checkbox maps to this; the backend never trusts it blindly
   * — it's re-validated (permissions, org, link status) and only acted on
   * strictly after the motor confirms the revocation.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  removeAssignmentsAfterUnlink?: boolean;
}
