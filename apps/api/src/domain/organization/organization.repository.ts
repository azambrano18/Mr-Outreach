import { CreateOrganizationInput, Organization } from './organization.entity';

/**
 * Port. Both InMemoryOrganizationRepository and PrismaOrganizationRepository
 * implement this; services depend on the interface only, never on a
 * concrete adapter.
 */
export interface OrganizationRepository {
  findById(id: string): Promise<Organization | null>;
  create(input: CreateOrganizationInput): Promise<Organization>;
}
