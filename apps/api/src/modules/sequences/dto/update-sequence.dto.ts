import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

class SequenceWindowDto {
  @ApiPropertyOptional({ example: '08:00' })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'start debe tener formato HH:mm.' })
  start!: string;

  @ApiPropertyOptional({ example: '19:00' })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'end debe tener formato HH:mm.' })
  end!: string;
}

/** §7/§11 — the sequence's sending window (días habilitados + horario), editable from the wizard's step 5. */
class SequenceScheduleDto {
  @ApiPropertyOptional({ enum: WEEKDAYS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(WEEKDAYS, { each: true })
  days!: string[];

  @ApiPropertyOptional({ type: [SequenceWindowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SequenceWindowDto)
  windows!: SequenceWindowDto[];
}

export class UpdateSequenceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  timezone?: string;

  @ApiPropertyOptional({
    description:
      'Id of a mailbox assigned to the sequence executive. Send null to unset the sender account.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  mailboxId?: string | null;

  @ApiPropertyOptional({ type: SequenceScheduleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SequenceScheduleDto)
  schedule?: SequenceScheduleDto;
}
