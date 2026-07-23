import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsValidTemplateText } from '../validators/valid-template-text.decorator';

export class CreateTemplateDto {
  @ApiProperty({ description: 'Identifying name for the template, e.g. "Primer contacto".' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'May include {variable} placeholders.' })
  @IsString()
  @IsNotEmpty()
  @IsValidTemplateText({ message: 'El asunto tiene una variable con formato inválido.' })
  subject!: string;

  @ApiProperty({ description: 'May include {variable} placeholders.' })
  @IsString()
  @IsNotEmpty()
  @IsValidTemplateText({ message: 'El cuerpo tiene una variable con formato inválido.' })
  body!: string;
}
