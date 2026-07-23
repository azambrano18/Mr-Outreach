import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { PRISMA_SERVICE } from './tokens';
import { PrismaService } from './prisma/prisma.service';

export type PersistenceStatus = 'available' | 'connected' | 'unavailable';

/**
 * Lets /health/ready report driver-aware persistence status without
 * knowing anything about Prisma itself — memory mode has no external
 * dependency to check, so it is always "available"; postgres mode pings
 * the real connection.
 */
@Injectable()
export class PersistenceHealthIndicator {
  constructor(
    private readonly config: AppConfigService,
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService | null,
  ) {}

  async checkStatus(): Promise<PersistenceStatus> {
    if (this.config.persistenceDriver === 'memory') {
      return 'available';
    }

    try {
      await this.prisma!.ping();
      return 'connected';
    } catch {
      return 'unavailable';
    }
  }
}
