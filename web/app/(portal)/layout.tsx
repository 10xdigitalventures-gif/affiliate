import { PortalSidebar } from '@/components/shell/portal-sidebar'
import { Topbar } from '@/components/shell/topbar'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <PortalSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-auto p-4">{children}</main>
      </div>
    </div>
  )
}
