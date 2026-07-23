import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class SendTestStepDto {
  @ApiProperty()
  @IsEmail()
  to!: string;
}
