import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { normalizeInstitutionalEmail } from '@outreach/validation';
import { IsInstitutionalEmail } from '../validators/is-institutional-email.decorator';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @ApiPropertyOptional({ description: 'Institutional email — must end in @mejoreferido.cl.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? normalizeInstitutionalEmail(value) : value))
  @IsEmail()
  @IsInstitutionalEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Id of a role belonging to the same organization.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  roleId?: string;
}
