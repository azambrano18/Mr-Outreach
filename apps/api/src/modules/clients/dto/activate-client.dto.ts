import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Fase 1.5 — "Activar en Mr Outreach", not "crear cliente": name/rut/
 * industry/estado corporativo intentionally have NO fields here anymore —
 * they always come from `maestro_clientes` via CrmClientEligibilityService.
 * The global ValidationPipe (`forbidNonWhitelisted: true`, see main.ts)
 * already rejects any of those if a client sends them, so nothing extra is
 * needed here to enforce that.
 */
export class ActivateClientDto {
  @ApiProperty({ description: 'The id of the matching row in the external CRM (maestro_clientes).' })
  @IsInt()
  @Min(1)
  crmClientId!: number;

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
