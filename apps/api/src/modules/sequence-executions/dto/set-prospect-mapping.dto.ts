import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class SetProspectMappingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiProperty({ type: Object })
  @IsObject()
  customVariables!: Record<string, string>;
}
