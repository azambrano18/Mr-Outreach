import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBooleanString, IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';
import { SequenceStatus } from '../../../domain/sequence/sequence.entity';

const SEQUENCE_STATUSES: SequenceStatus[] = ['DRAFT', 'PAUSED', 'ARCHIVED'];

/** Spec §4.2 — every filter is optional and combinable; query strings only, so booleans/dates arrive as plain strings. */
export class ListAdminSequencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  executiveId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mailboxId?: string;

  @ApiPropertyOptional({ enum: SEQUENCE_STATUSES })
  @IsOptional()
  @IsIn(SEQUENCE_STATUSES)
  status?: SequenceStatus;

  @ApiPropertyOptional({ description: '"true" = activas (no archivadas), "false" = finalizadas (archivadas).' })
  @IsOptional()
  @IsBooleanString()
  activeOnly?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  startedFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  startedTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  search?: string;
}
