import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class SendTestSignatureDto {
  @ApiProperty()
  @IsEmail()
  to!: string;
}
