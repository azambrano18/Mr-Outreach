import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetThreadReadStateDto {
  @ApiProperty()
  @IsBoolean()
  isUnread!: boolean;
}
