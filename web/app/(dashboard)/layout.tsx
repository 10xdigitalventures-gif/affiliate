import { Sidebar } from '@/components/shell/sidebar'
import { Topbar } from '@/components/shell/topbar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-auto p-4">{children}</main>
      </div>
    </div>
  )
}
