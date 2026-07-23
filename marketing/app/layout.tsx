import type { Metadata } from 'next'
import './globals.css'
import { Navbar } from '@/components/site/Navbar'
import { Footer } from '@/components/site/Footer'
import { site } from '@/lib/site'

export const metadata: Metadata = {
  title: { default: site.name + ' \u2014 ' + site.tagline, template: '%s \u2014 ' + site.name },
  description: site.description,
  metadataBase: new URL('https://web.mentoringhub.online'),
  openGraph: { title: site.name, description: site.description, type: 'website' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Navbar />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  )
}
