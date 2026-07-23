import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsString } from 'class-validator';

export class ReorderSequenceStepsDto {
  @ApiProperty({ type: [String], description: 'Full ordered list of the sequence’s step ids.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  stepIds!: string[];
}
