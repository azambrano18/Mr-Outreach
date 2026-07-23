import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { Organization } from '../../domain/organization/organization.entity';
import { User } from '../../domain/user/user.entity';
import {
  SignatureRenderContext,
  renderSignatureText,
  resolveSignatureVariable,
} from './signature-variable-resolver';

describe('resolveSignatureVariable', () => {
  const mailbox = { email: 'ventas@example.com' } as Mailbox;
  const organization = { name: 'MejoReferido' } as Organization;

  it('resolves mailbox.email directly from the mailbox', () => {
    const ctx: SignatureRenderContext = { mailbox, organization, sender: null };
    expect(resolveSignatureVariable('mailbox.email', ctx)).toEqual({
      value: 'ventas@example.com',
      isReal: true,
    });
  });

  it('resolves sender.* from a real assigned executive, splitting the full name', () => {
    const sender = {
      firstName: 'María',
      lastName: 'Pérez',
      email: 'maria@example.com',
    } as User;
    const ctx: SignatureRenderContext = { mailbox, organization, sender };

    expect(resolveSignatureVariable('sender.firstName', ctx)).toEqual({
      value: 'María',
      isReal: true,
    });
    expect(resolveSignatureVariable('sender.lastName', ctx)).toEqual({
      value: 'Pérez',
      isReal: true,
    });
    expect(resolveSignatureVariable('sender.company', ctx)).toEqual({
      value: 'MejoReferido',
      isReal: true,
    });
  });

  it('falls back to a labeled generic example when no executive is assigned', () => {
    const ctx: SignatureRenderContext = { mailbox, organization, sender: null };

    const result = resolveSignatureVariable('sender.name', ctx);
    expect(result.isReal).toBe(false);
    expect(result.value).not.toBe('');
  });

  it('falls back to the generic Templates sample values for anything outside sender./mailbox.', () => {
    const ctx: SignatureRenderContext = { mailbox, organization, sender: null };

    expect(resolveSignatureVariable('nombre', ctx)).toEqual({
      value: 'Juan Pérez',
      isReal: false,
    });
    expect(resolveSignatureVariable('unknown_key', ctx).value).toBe('[valor de ejemplo]');
  });
});

describe('renderSignatureText', () => {
  it('substitutes every occurrence and reports whether real sender data was used', () => {
    const ctx: SignatureRenderContext = {
      mailbox: { email: 'ventas@example.com' } as Mailbox,
      organization: { name: 'MejoReferido' } as Organization,
      sender: { firstName: 'María', lastName: 'Pérez', email: 'm@example.com' } as User,
    };

    const { rendered, usesRealSenderData } = renderSignatureText(
      '{sender.name} — {mailbox.email}',
      ['sender.name', 'mailbox.email'],
      ctx,
    );

    expect(rendered).toBe('María Pérez — ventas@example.com');
    expect(usesRealSenderData).toBe(true);
  });
});
