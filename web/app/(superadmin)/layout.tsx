import { AuthGuard } from '@/components/auth/auth-guard'
import { SuperAdminSidebar } from '@/components/shell/superadmin-sidebar'
import { Topbar } from '@/components/shell/topbar'

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard area="superadmin">
      <div className="flex h-screen">
        <SuperAdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar title="Platform console" />
          <main className="flex-1 overflow-auto p-4">{children}</main>
        </div>
      </div>
    </AuthGuard>
  )
}
