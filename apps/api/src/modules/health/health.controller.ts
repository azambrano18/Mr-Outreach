import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService, LivenessResult, ReadinessResult } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Whether the process is running. Never checks external dependencies.' })
  live(): LivenessResult {
    return this.healthService.live();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Which persistence/engine adapters are active and whether they respond.',
  })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessResult> {
    const result = await this.healthService.ready();
    res.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
