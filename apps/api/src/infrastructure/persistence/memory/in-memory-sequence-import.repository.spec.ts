import { runSequenceImportRepositoryContractTests } from '../contracts/sequence-import-repository.contract';
import { InMemorySequenceImportRepository } from './in-memory-sequence-import.repository';
import { MemoryStore } from './memory-store';

describe('InMemorySequenceImportRepository (contract)', () => {
  let repo: InMemorySequenceImportRepository;

  runSequenceImportRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemorySequenceImportRepository(new MemoryStore());
    },
  );
});
