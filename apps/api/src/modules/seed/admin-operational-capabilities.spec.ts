import {
  ADMIN_PERMISSION_KEYS,
  EXECUTIVE_PERMISSION_KEYS,
} from './permission-catalog';

/**
 * "Capacidades operativas del administrador" — the admin role now also
 * operates as an executive (same permissions, same use cases, no
 * role === 'EXECUTIVE' comparison anywhere in this codebase — see
 * PermissionsGuard; there is no RolesGuard at all). These assertions are
 * the authoritative source for the sidebar's visibility, since
 * apps/web/lib/admin-navigation.ts's `isNavItemVisible` is a pure function
 * of exactly these two permission lists — an item shows for the admin iff
 * its gating permission is in ADMIN_PERMISSION_KEYS, exactly like an
 * executive.
 */
describe('Admin operational capabilities — permission wiring', () => {
  const templateOperationalKeys = [
    'sequence_templates.create_own',
    'sequence_templates.read_own',
    'sequence_templates.update_own',
    'sequence_templates.publish_own',
    'sequence_templates.archive_own',
    'sequence_templates.delete_own',
  ];
  const executionOperationalKeys = [
    'sequence_executions.create_own',
    'sequence_executions.read_own',
    'sequence_executions.update_own',
    'sequence_executions.delete_own',
    'sequence_executions.import_own',
    'sequence_executions.start_own',
    'sequence_executions.refresh_status_own',
  ];

  it('grants the admin every Plantilla-operational permission an executive has — "Plantillas" becomes visible in the nav', () => {
    for (const key of templateOperationalKeys) {
      expect(ADMIN_PERMISSION_KEYS).toContain(key);
      expect(EXECUTIVE_PERMISSION_KEYS).toContain(key);
    }
  });

  it('grants the admin every Gestión-operational permission an executive has — "Gestiones" becomes visible in the nav', () => {
    for (const key of executionOperationalKeys) {
      expect(ADMIN_PERMISSION_KEYS).toContain(key);
      expect(EXECUTIVE_PERMISSION_KEYS).toContain(key);
    }
  });

  it('keeps the admin monitor/administrative permissions separate — an executive never gets them', () => {
    const adminOnlyKeys = [
      'sequence_executions.monitor_all',
      'sequence_executions.refresh_status_all',
      'sequence_executions.pause_all',
      'sequence_executions.resume_all',
      'sequence_executions.stop_all',
      'sequence_executions.restart_all',
      'simulation_conversations.create',
      'simulation_conversations.delete',
      'mailboxes.read.all',
      'mailboxes.assign',
      'mailboxes.link',
      'mailboxes.unlink',
      'audit.read',
      'users.read',
    ];
    for (const key of adminOnlyKeys) {
      expect(ADMIN_PERMISSION_KEYS).toContain(key);
      expect(EXECUTIVE_PERMISSION_KEYS).not.toContain(key);
    }
  });

  it('leaves the legacy Secuencias permission in the catalog (frozen, not deleted) but never grants it to an executive — apps/web/lib/admin-navigation.ts no longer has any item gated on it (verified by inspection: the "Secuencias" nav entry was removed, not just hidden)', () => {
    expect(ADMIN_PERMISSION_KEYS).toContain('sequences.read_all');
    expect(EXECUTIVE_PERMISSION_KEYS).not.toContain('sequences.read_all');
  });
});
