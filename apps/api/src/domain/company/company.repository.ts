import { Company, CreateCompanyInput, UpdateCompanyInput } from './company.entity';

export interface CompanyRepository {
  findById(id: string): Promise<Company | null>;
  findByNormalizedName(
    organizationId: string,
    clientId: string,
    normalizedName: string,
  ): Promise<Company | null>;
  findByClient(organizationId: string, clientId: string): Promise<Company[]>;
  create(input: CreateCompanyInput): Promise<Company>;
  update(id: string, input: UpdateCompanyInput): Promise<Company>;
}
