import { SuperAdminController } from './superadmin.controller'

describe('SuperAdminController', () => {
  function makeController() {
    const service: any = {
      overview: jest.fn().mockResolvedValue({ totalOrgs: 1 }),
      createPlan: jest.fn().mockResolvedValue({ id: 'plan-1' }),
      listTenants: jest.fn().mockResolvedValue([{ id: 'org-1' }]),
      setTenantStatus: jest.fn().mockResolvedValue({ id: 'org-1', status: 'suspended' }),
    }
    return { controller: new SuperAdminController(service), service }
  }

  it('delegates overview loading', async () => {
    const { controller, service } = makeController()
    await expect(controller.overview()).resolves.toEqual({ totalOrgs: 1 })
    expect(service.overview).toHaveBeenCalled()
  })

  it('delegates plan creation', async () => {
    const { controller, service } = makeController()
    const dto: any = { key: 'pro', name: 'Pro', priceCents: 1000, features: {}, limits: {} }
    await expect(controller.createPlan(dto)).resolves.toEqual({ id: 'plan-1' })
    expect(service.createPlan).toHaveBeenCalledWith(dto)
  })

  it('delegates tenant status updates', async () => {
    const { controller, service } = makeController()
    const dto: any = { status: 'suspended' }
    await expect(controller.setTenantStatus('org-1', dto)).resolves.toEqual({ id: 'org-1', status: 'suspended' })
    expect(service.setTenantStatus).toHaveBeenCalledWith('org-1', dto)
  })
})
