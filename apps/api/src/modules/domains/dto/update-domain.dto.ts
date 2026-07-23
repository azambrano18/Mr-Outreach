import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { DomainStatus } from '../../../domain/domain-entity/domain.entity';

const STATUSES: DomainStatus[] = ['ACTIVE', 'INACTIVE', 'ARCHIVED'];

export class UpdateDomainDto {
  @ApiPropertyOptional({ example: 'litoral-software.cl' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i, {
    message: 'domainName must look like a real domain (e.g. litoral-software.cl).',
  })
  domainName?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: DomainStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
