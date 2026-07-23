import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LinkDomainDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  domainId!: string;
}
