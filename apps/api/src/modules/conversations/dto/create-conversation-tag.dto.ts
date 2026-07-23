import { ApiProperty } from '@nestjs/swagger';
import { IsHexColor, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateConversationTagDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: '#8B3FC9' })
  @IsHexColor()
  color!: string;
}
