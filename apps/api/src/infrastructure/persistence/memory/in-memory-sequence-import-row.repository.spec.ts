import { runSequenceImportRowRepositoryContractTests } from '../contracts/sequence-import-row-repository.contract';
import { InMemorySequenceImportRowRepository } from './in-memory-sequence-import-row.repository';
import { MemoryStore } from './memory-store';

describe('InMemorySequenceImportRowRepository (contract)', () => {
  let repo: InMemorySequenceImportRowRepository;

  runSequenceImportRowRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemorySequenceImportRowRepository(new MemoryStore());
    },
  );
});
