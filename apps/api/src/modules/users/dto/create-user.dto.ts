import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { normalizeInstitutionalEmail } from '@outreach/validation';
import { IsInstitutionalEmail } from '../validators/is-institutional-email.decorator';

export class CreateUserDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiProperty({ description: 'Institutional email — must end in @mejoreferido.cl.' })
  @Transform(({ value }) => (typeof value === 'string' ? normalizeInstitutionalEmail(value) : value))
  @IsEmail()
  @IsInstitutionalEmail()
  email!: string;

  @ApiProperty({ description: 'Id of a role belonging to the same organization.' })
  @IsString()
  @IsNotEmpty()
  roleId!: string;
}
