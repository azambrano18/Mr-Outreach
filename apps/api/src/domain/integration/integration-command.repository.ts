import {
  CreateIntegrationCommandInput,
  IntegrationCommand,
  UpdateIntegrationCommandInput,
} from './integration-command.entity';

export interface IntegrationCommandFilter {
  aggregateType?: string;
  aggregateId?: string;
  status?: string;
  search?: string;
}

export interface IntegrationCommandRepository {
  findById(id: string): Promise<IntegrationCommand | null>;
  findByCommandId(organizationId: string, commandId: string): Promise<IntegrationCommand | null>;
  /** The idempotency check §43 relies on — a duplicate submission finds this and returns its existing outcome instead of creating a second row. */
  findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<IntegrationCommand | null>;
  findAll(organizationId: string, filter?: IntegrationCommandFilter): Promise<IntegrationCommand[]>;
  create(input: CreateIntegrationCommandInput): Promise<IntegrationCommand>;
  update(id: string, input: UpdateIntegrationCommandInput): Promise<IntegrationCommand>;
}
