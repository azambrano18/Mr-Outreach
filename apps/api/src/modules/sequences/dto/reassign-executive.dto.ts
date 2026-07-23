import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReassignExecutiveDto {
  @ApiProperty({ description: 'Id of the new operationally-responsible executive.' })
  @IsString()
  @IsNotEmpty()
  executiveId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
