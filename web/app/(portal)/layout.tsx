import { PortalSidebar } from '@/components/shell/portal-sidebar'
import { Topbar } from '@/components/shell/topbar'
import { AuthGuard } from '@/components/auth/auth-guard'
import { PortalMobileNav } from '@/components/shell/portal-mobile-nav'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard area="portal">
      <div className="flex h-screen">
        <PortalSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 overflow-auto p-4 pb-24 lg:pb-4">{children}</main>
        </div>
        <PortalMobileNav />
      </div>
    </AuthGuard>
  )
}
