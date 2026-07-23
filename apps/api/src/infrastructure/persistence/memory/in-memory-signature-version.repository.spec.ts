import { InMemorySignatureVersionRepository } from './in-memory-signature-version.repository';
import { MemoryStore } from './memory-store';

describe('InMemorySignatureVersionRepository', () => {
  it('numbers versions incrementally per signature, starting at 1', async () => {
    const repo = new InMemorySignatureVersionRepository(new MemoryStore());

    const v1 = await repo.create({
      signatureId: 'signature_1',
      htmlContent: '<p>Saludos, {nombre}</p>',
      plainTextContent: 'Saludos, {nombre}',
      createdBy: 'user_1',
    });
    const v2 = await repo.create({
      signatureId: 'signature_1',
      htmlContent: '<p>Atentamente, {nombre}</p>',
      plainTextContent: 'Atentamente, {nombre}',
      createdBy: 'user_1',
    });

    expect(v1.versionNumber).toBe(1);
    expect(v2.versionNumber).toBe(2);
  });

  it('numbers versions independently per signature', async () => {
    const repo = new InMemorySignatureVersionRepository(new MemoryStore());

    await repo.create({
      signatureId: 'signature_1',
      htmlContent: '<p>A</p>',
      plainTextContent: 'A',
      createdBy: 'user_1',
    });
    const otherFirst = await repo.create({
      signatureId: 'signature_2',
      htmlContent: '<p>B</p>',
      plainTextContent: 'B',
      createdBy: 'user_1',
    });

    expect(otherFirst.versionNumber).toBe(1);
  });

  it('findBySignature returns most recent first, scoped to that signature', async () => {
    const repo = new InMemorySignatureVersionRepository(new MemoryStore());

    const v1 = await repo.create({
      signatureId: 'signature_1',
      htmlContent: '<p>A</p>',
      plainTextContent: 'A',
      createdBy: 'u',
    });
    const v2 = await repo.create({
      signatureId: 'signature_1',
      htmlContent: '<p>B</p>',
      plainTextContent: 'B',
      createdBy: 'u',
    });
    await repo.create({
      signatureId: 'signature_2',
      htmlContent: '<p>C</p>',
      plainTextContent: 'C',
      createdBy: 'u',
    });

    const history = await repo.findBySignature('signature_1');

    expect(history).toHaveLength(2);
    expect(history[0].id).toBe(v2.id);
    expect(history[1].id).toBe(v1.id);
  });

  it('findById returns null for an unknown id', async () => {
    const repo = new InMemorySignatureVersionRepository(new MemoryStore());

    expect(await repo.findById('does-not-exist')).toBeNull();
  });
});
