import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ManagedClientStatus } from '../../../domain/client/managed-client.entity';

const STATUSES: ManagedClientStatus[] = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED'];

/**
 * Fase 1.5 — `name`/`industry` removed: they are CRM snapshots now, only
 * ever written by ClientsService.upsertFromVerifiedCrmClient /
 * assertClientCrmEligible, never by an administrator directly.
 */
export class UpdateClientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  internalCode?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: ManagedClientStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supervisorUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
