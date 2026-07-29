import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * §2 (Fase 1.7) — no `delayUnit`: the wait between envíos is always expressed
 * in business days, never editable/selectable. `delayValue` is the only
 * schedule input left, bounded to a sane range. No `name`, `enabled`,
 * `subjectTemplate`, `allowedWeekdays`, `sendWindowStart`/`sendWindowEnd` or
 * `delayReference` either: the schedule is fixed and non-configurable
 * (Mon-Fri, 08:00-19:00) and is always re-asserted server-side regardless of
 * what a caller sends (see SequenceTemplatesService.updateStep). `headerText`
 * is the individual, optional, plain-text header for this one envío — never
 * accepted for Envío 1's delay fields, since Envío 1 fires at the Gestión's
 * start.
 */
export class UpdateSequenceTemplateStepDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  headerText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  plainTextBody?: string;

  /**
   * §2 (Fase 1.7) — the strict 1-20 business-day bound only makes sense for
   * Envíos 2/3; Envío 1 has no wait (its stored value is always 0) but the
   * frontend still round-trips the whole draft object on every autosave, so
   * this DTO only rejects negatives — SequenceTemplatesService.updateStep
   * enforces the real 1-20 range once it knows which envío this is.
   */
  @ApiPropertyOptional({ description: 'Días hábiles después del envío anterior (solo Envíos 2/3).', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0, { message: 'El valor no puede ser negativo.' })
  delayValue?: number;
}
