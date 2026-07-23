import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsValidTemplateText } from '../validators/valid-template-text.decorator';

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ description: 'May include {variable} placeholders.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsValidTemplateText({ message: 'El asunto tiene una variable con formato inválido.' })
  subject?: string;

  @ApiPropertyOptional({ description: 'May include {variable} placeholders.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsValidTemplateText({ message: 'El cuerpo tiene una variable con formato inválido.' })
  body?: string;
}
