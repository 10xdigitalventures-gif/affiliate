'use client'
import { useParams } from 'next/navigation'
import { SignupExperience } from '../../apply/signup-experience'

// Iframe-embeddable version of the affiliate sign-up form. Rendered with no
// page chrome and a transparent background so tenants can drop it into their
// own site (WordPress, Shopify, etc). Framing is allowed via next.config.js
// (Content-Security-Policy: frame-ancestors *).
export default function EmbedApplyPage() {
  const params = useParams()
  const slug = params?.slug as string
  return (
    <div className="w-full p-2 bg-transparent">
      <SignupExperience slug={slug} variant="embed" />
    </div>
  )
}
