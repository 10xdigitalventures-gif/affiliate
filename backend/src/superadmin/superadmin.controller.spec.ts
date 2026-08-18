import { SuperAdminController } from './superadmin.controller'

function makeController() {
  const service: any = {
    overview: jest.fn().mockResolvedValue({ totalOrgs: 5, activeOrgs: 4 }),
    listTenants: jest.fn().mockResolvedValue([{ id: 'org-1', name: 'Acme' }]),
    getTenant: jest.fn().mockResolvedValue({ id: 'org-1', name: 'Acme' }),
    assignPlan: jest.fn().mockResolvedValue({ ok: true }),
    setTenantStatus: jest.fn().mockResolvedValue({ ok: true }),
    listPlans: jest.fn().mockResolvedValue([]),
    createPlan: jest.fn().mockResolvedValue({ id: 'plan-1' }),
    updatePlan: jest.fn().mockResolvedValue({ id: 'plan-1' }),
    deletePlan: jest.fn().mockResolvedValue({ deleted: true }),
    getPlan: jest.fn().mockResolvedValue({ id: 'plan-1' }),
  }
  return { controller: new SuperAdminController(service), service }
}

describe('SuperAdminController', () => {
  it('returns platform overview', async () => {
    const { controller, service } = makeController()
    const result = await controller.overview()
    expect(service.overview).toHaveBeenCalled()
    expect(result).toMatchObject({ totalOrgs: 5 })
  })

  it('lists tenants with optional search', async () => {
    const { controller, service } = makeController()
    const result = await controller.listTenants('acme')
    expect(service.listTenants).toHaveBeenCalledWith('acme')
    expect(result).toHaveLength(1)
  })

  it('gets a single tenant', async () => {
    const { controller, service } = makeController()
    const result = await controller.getTenant('org-1')
    expect(service.getTenant).toHaveBeenCalledWith('org-1')
    expect(result).toMatchObject({ id: 'org-1' })
  })

  it('assigns a plan to a tenant', async () => {
    const { controller, service } = makeController()
    const dto: any = { planId: 'plan-1', status: 'active' }
    await controller.assignPlan('org-1', dto)
    expect(service.assignPlan).toHaveBeenCalledWith('org-1', dto)
  })

  it('sets tenant status', async () => {
    const { controller, service } = makeController()
    const dto: any = { status: 'suspended' }
    await controller.setTenantStatus('org-1', dto)
    expect(service.setTenantStatus).toHaveBeenCalledWith('org-1', dto)
  })

  it('lists plans', async () => {
    const { controller, service } = makeController()
    await controller.listPlans()
    expect(service.listPlans).toHaveBeenCalled()
  })

  it('creates a plan', async () => {
    const { controller, service } = makeController()
    const dto: any = { key: 'pro', name: 'Pro', priceCents: 4900, features: {}, limits: {} }
    const result = await controller.createPlan(dto)
    expect(service.createPlan).toHaveBeenCalledWith(dto)
    expect(result).toMatchObject({ id: 'plan-1' })
  })

  it('updates a plan', async () => {
    const { controller, service } = makeController()
    const dto: any = { name: 'Pro Plus' }
    await controller.updatePlan('plan-1', dto)
    expect(service.updatePlan).toHaveBeenCalledWith('plan-1', dto)
  })

  it('deletes a plan', async () => {
    const { controller, service } = makeController()
    await controller.deletePlan('plan-1')
    expect(service.deletePlan).toHaveBeenCalledWith('plan-1')
  })
})
