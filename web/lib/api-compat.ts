import {
  api,
  Auth as BaseAuth,
  Portal as BasePortal,
} from './api'

export * from './api'

export type AuthUser = import('./api').AuthUser & {
  phoneNumber?: string | null
  avatarUrl?: string | null
}

export const Auth = {
  ...BaseAuth,
  forgotPassword: (email: string, orgSlug?: string) =>
    api<{ ok: boolean }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email, ...(orgSlug ? { orgSlug } : {}) }),
    }),
  updateProfile: (dto: {
    fullName: string
    email: string
    currentPassword?: string
    phoneNumber?: string | null
    avatarUrl?: string | null
  }) =>
    api<AuthUser>('/auth/me', { method: 'PATCH', body: JSON.stringify(dto) }),
}

export type TeamPermission = {
  id: string
  key: string
  description?: string | null
}

export type TeamRole = {
  id: string
  organizationId: string | null
  name: string
  isSystem: boolean
  permissions: Array<{ permission: TeamPermission }>
  _count?: { users: number; invitations: number }
}

export type TeamMember = {
  id: string
  email: string
  fullName?: string | null
  status: string
  isSuperAdmin: boolean
  lastLoginAt?: string | null
  createdAt: string
  roles: Array<{ role: Pick<TeamRole, 'id' | 'name' | 'isSystem' | 'organizationId'> }>
}

export type TeamInvitation = {
  id: string
  email: string
  expiresAt: string
  createdAt: string
  invitedByUserId?: string | null
  role?: { id: string; name: string } | null
}

export const Team = {
  members: () => api<TeamMember[]>('/team/members'),
  roles: () => api<TeamRole[]>('/team/roles'),
  permissions: () => api<TeamPermission[]>('/team/permissions'),
  invitations: () => api<TeamInvitation[]>('/team/invitations'),
  createRole: (name: string, permissionKeys: string[]) =>
    api<TeamRole>('/team/roles', { method: 'POST', body: JSON.stringify({ name, permissionKeys }) }),
  updateMember: (id: string, dto: { roleIds?: string[]; status?: string }) =>
    api<TeamMember>(`/team/members/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  revokeInvitation: (id: string) => api(`/team/invitations/${id}`, { method: 'DELETE' }),
  deleteRole: (id: string) => api(`/team/roles/${id}`, { method: 'DELETE' }),
}

export type PortalCoupon = {
  id: string
  code: string
  status: string
  expiresAt: string | null
  store: { id: string; name: string; platform: string }
  _count: { orders: number }
}

export const Portal = {
  ...BasePortal,
  coupons: () => api<PortalCoupon[]>('/portal/coupons'),
}
