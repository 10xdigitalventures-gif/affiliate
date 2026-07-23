'use client'

import { FormEvent, useMemo, useState } from 'react'
import { Auth, Entitlements, Team } from '@/lib/api'
import type { TeamInvitation, TeamMember, TeamPermission, TeamRole } from '@/lib/api'
import { useFetch, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'

const inputClass = 'w-full rounded-md border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-brand'

function roleLabel(role: TeamRole) {
  return role.organizationId === null ? `${role.name} (platform)` : role.name
}

export default function TeamPage() {
  const members = useFetch(() => Team.members(), [])
  const roles = useFetch(() => Team.roles(), [])
  const permissions = useFetch(() => Team.permissions(), [])
  const invitations = useFetch(() => Team.invitations(), [])
  const me = useFetch(() => Auth.me(), [])
  const entitlement = useFetch(() => Entitlements.me(), [])

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRoleId, setInviteRoleId] = useState('')
  const [roleName, setRoleName] = useState('')
  const [rolePermissions, setRolePermissions] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const availableRoles = roles.data ?? []
  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, TeamPermission[]>()
    for (const permission of permissions.data ?? []) {
      const group = permission.key.split('.')[0]
      groups.set(group, [...(groups.get(group) ?? []), permission])
    }
    return [...groups.entries()]
  }, [permissions.data])

  function reloadAll() {
    members.reload()
    roles.reload()
    invitations.reload()
    entitlement.reload()
  }

  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(null), 3000)
  }

  async function invite(event: FormEvent) {
    event.preventDefault()
    if (!inviteRoleId) return setError('Select a role for the teammate.')
    setBusy('invite')
    setError(null)
    try {
      await Auth.invite({ email: inviteEmail, fullName: inviteName || undefined, roleId: inviteRoleId })
      setInviteEmail('')
      setInviteName('')
      showNotice('Invitation email sent.')
      reloadAll()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send invitation')
    } finally {
      setBusy(null)
    }
  }

  async function createRole(event: FormEvent) {
    event.preventDefault()
    setBusy('role')
    setError(null)
    try {
      await Team.createRole(roleName, rolePermissions)
      setRoleName('')
      setRolePermissions([])
      showNotice('Custom role created.')
      roles.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create role')
    } finally {
      setBusy(null)
    }
  }

  async function changeMemberRole(member: TeamMember, roleId: string) {
    setBusy(`member-${member.id}`)
    setError(null)
    try {
      await Team.updateMember(member.id, { roleIds: [roleId] })
      showNotice('Member role updated. Their existing sessions were refreshed.')
      members.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update member')
    } finally {
      setBusy(null)
    }
  }

  async function toggleMember(member: TeamMember) {
    const next = member.status === 'suspended' ? 'active' : 'suspended'
    if (next === 'suspended' && !window.confirm(`Suspend ${member.email}? Their sessions will be revoked.`)) return
    setBusy(`member-${member.id}`)
    setError(null)
    try {
      await Team.updateMember(member.id, { status: next })
      showNotice(next === 'active' ? 'Member reactivated.' : 'Member suspended and signed out.')
      reloadAll()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update member')
    } finally {
      setBusy(null)
    }
  }

  async function revokeInvitation(invitation: TeamInvitation) {
    if (!window.confirm(`Revoke the invitation for ${invitation.email}?`)) return
    setBusy(`invite-${invitation.id}`)
    setError(null)
    try {
      await Team.revokeInvitation(invitation.id)
      showNotice('Invitation revoked.')
      reloadAll()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not revoke invitation')
    } finally {
      setBusy(null)
    }
  }

  async function deleteRole(role: TeamRole) {
    if (!window.confirm(`Delete the “${role.name}” role?`)) return
    setBusy(`role-${role.id}`)
    setError(null)
    try {
      await Team.deleteRole(role.id)
      showNotice('Custom role deleted.')
      roles.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete role')
    } finally {
      setBusy(null)
    }
  }

  const seatLimit = entitlement.data?.limits.teamMembers
  const seatUsage = entitlement.data?.usage.teamMembers

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <PageHeader
        title="Team & roles"
        subtitle="Invite workspace staff and control exactly what each role can access."
        actions={
          seatUsage !== undefined && seatLimit !== undefined ? (
            <span className="rounded-md border border-line bg-white px-2.5 py-1.5 text-xs text-muted">
              {seatUsage} / {seatLimit < 0 ? 'Unlimited' : seatLimit} seats
            </span>
          ) : undefined
        }
      />

      {(error || members.error || roles.error || permissions.error || invitations.error) && (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error || members.error || roles.error || permissions.error || invitations.error}
        </div>
      )}
      {notice && <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">{notice}</div>}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Invite teammate">
          <form onSubmit={invite} className="space-y-2.5">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-muted">
                <span>Name (optional)</span>
                <input className={inputClass} value={inviteName} onChange={(event) => setInviteName(event.target.value)} maxLength={80} />
              </label>
              <label className="space-y-1 text-xs text-muted">
                <span>Email</span>
                <input className={inputClass} type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
              </label>
            </div>
            <label className="block space-y-1 text-xs text-muted">
              <span>Role</span>
              <select className={inputClass} required value={inviteRoleId} onChange={(event) => setInviteRoleId(event.target.value)}>
                <option value="">Select a role…</option>
                {availableRoles.map((role) => <option key={role.id} value={role.id}>{roleLabel(role)}</option>)}
              </select>
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">A one-time, expiring password setup link will be emailed.</p>
              <Button type="submit" disabled={busy === 'invite'}>{busy === 'invite' ? 'Sending…' : 'Send invite'}</Button>
            </div>
          </form>
        </Card>

        <Card title="Pending invitations">
          {invitations.loading ? <p className="text-xs text-muted">Loading…</p> : (invitations.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted">No pending invitations.</p>
          ) : (
            <div className="divide-y divide-line">
              {invitations.data?.map((invitation) => (
                <div key={invitation.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{invitation.email}</p>
                    <p className="text-xs text-muted">{invitation.role?.name || 'No role'} · expires {shortDate(invitation.expiresAt)}</p>
                  </div>
                  <Button variant="danger" onClick={() => revokeInvitation(invitation)} disabled={busy === `invite-${invitation.id}`}>Revoke</Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Workspace members">
        {members.loading ? <p className="text-xs text-muted">Loading members…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b border-line text-muted">
                <tr><th className="pb-2 font-medium">Member</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">Role</th><th className="pb-2 font-medium">Last login</th><th className="pb-2 text-right font-medium">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {members.data?.map((member) => {
                  const isSelf = member.id === me.data?.id
                  const locked = isSelf || member.isSuperAdmin || busy === `member-${member.id}`
                  return (
                    <tr key={member.id}>
                      <td className="py-2.5 pr-3"><p className="font-medium text-ink">{member.fullName || 'Invited user'}</p><p className="text-muted">{member.email}</p></td>
                      <td className="py-2.5 pr-3"><StatusPill status={member.status} /></td>
                      <td className="py-2.5 pr-3">
                        <select
                          className="rounded-md border border-line bg-white px-2 py-1.5"
                          value={member.roles[0]?.role.id || ''}
                          disabled={locked || member.status === 'invited'}
                          onChange={(event) => changeMemberRole(member, event.target.value)}
                        >
                          <option value="" disabled>No role</option>
                          {availableRoles.map((role) => <option key={role.id} value={role.id}>{roleLabel(role)}</option>)}
                        </select>
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{member.lastLoginAt ? shortDate(member.lastLoginAt) : 'Never'}</td>
                      <td className="py-2.5 text-right">
                        {isSelf || member.isSuperAdmin ? <span className="text-muted">{isSelf ? 'You' : 'Protected'}</span> : member.status !== 'invited' ? (
                          <Button variant={member.status === 'suspended' ? 'outline' : 'danger'} disabled={locked} onClick={() => toggleMember(member)}>
                            {member.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                          </Button>
                        ) : <span className="text-muted">Awaiting invite</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <Card title="Roles">
          <div className="divide-y divide-line">
            {availableRoles.map((role) => (
              <div key={role.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div>
                  <div className="flex items-center gap-2"><p className="text-sm font-medium">{roleLabel(role)}</p>{role.isSystem && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-2xs text-muted">System</span>}</div>
                  <p className="mt-1 text-xs text-muted">{role.permissions.map((entry) => entry.permission.key).join(', ') || 'No permissions'}{role._count ? ` · ${role._count.users} members` : ''}</p>
                </div>
                {!role.isSystem && role.organizationId && <Button variant="danger" disabled={busy === `role-${role.id}`} onClick={() => deleteRole(role)}>Delete</Button>}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Create custom role">
          <form onSubmit={createRole} className="space-y-3">
            <label className="block space-y-1 text-xs text-muted"><span>Role name</span><input className={inputClass} required minLength={2} maxLength={60} value={roleName} onChange={(event) => setRoleName(event.target.value)} /></label>
            <div className="max-h-52 space-y-2 overflow-auto rounded-md border border-line p-2.5">
              {groupedPermissions.map(([group, items]) => (
                <fieldset key={group}>
                  <legend className="mb-1 text-xs font-semibold capitalize text-ink">{group}</legend>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {items.map((permission) => (
                      <label key={permission.id} className="flex items-center gap-2 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={rolePermissions.includes(permission.key)}
                          onChange={(event) => setRolePermissions((current) => event.target.checked ? [...current, permission.key] : current.filter((key) => key !== permission.key))}
                        />
                        {permission.key}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <Button type="submit" disabled={busy === 'role'}>{busy === 'role' ? 'Creating…' : 'Create role'}</Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
