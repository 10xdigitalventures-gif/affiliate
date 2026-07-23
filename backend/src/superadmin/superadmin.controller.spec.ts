import { SuperAdminController } from './superadmin.controller'

function makeController() {
  const tenant = {
    id: 'org-1',
    name: 'Acme',
    slug: 'acme',
    owner: { id: 'user-1', email: 'owner@example.com', fullName: 'Owner' },
  }
  const service: any = { createTenant: jest.fn().mockResolvedValue(tenant) }
  const audit: any = { log: jest.fn().mockResolvedValue({ id: 'audit-1' }) }
  const auth: any = { requestEmailLoginCode: jest.fn().mockResolvedValue({ ok: true }) }
  return { controller: new SuperAdminController(service, audit, auth), service, audit, auth, tenant }
}

describe('SuperAdminController.createTenant', () => {
  const actor: any = { sub: 'admin-1', organizationId: 'platform-org', isSuperAdmin: true }

  it('reports successful owner code delivery', async () => {
    const { controller } = makeController()
    const result = await controller.createTenant({
      name: 'Acme', slug: 'acme', ownerEmail: 'owner@example.com', sendLoginCode: true,
    }, { user: actor })

    expect(result.loginCodeSent).toBe(true)
    expect(result.loginCodeWarning).toBeNull()
  })

  it('keeps the created tenant when SMTP delivery fails', async () => {
    const { controller, auth } = makeController()
    jest.spyOn((controller as any).logger, 'error').mockImplementation(() => undefined)
    auth.requestEmailLoginCode.mockRejectedValue(new Error('SMTP unavailable'))

    const result = await controller.createTenant({
      name: 'Acme', slug: 'acme', ownerEmail: 'owner@example.com', sendLoginCode: true,
    }, { user: actor })

    expect(result.id).toBe('org-1')
    expect(result.loginCodeSent).toBe(false)
    expect(result.loginCodeWarning).toContain('Organization was created')
  })
})
