import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Deriva — this contact is swapped out for a new one within the same company/sequence. */
export class ReferProspectDto {
  @ApiProperty()
  @IsEmail()
  newContactEmail!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  newContactFirstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  newContactLastName?: string;

  @ApiProperty()
  @IsBoolean()
  sendFirstStepImmediately!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
