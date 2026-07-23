'use client'
import { useParams } from 'next/navigation'
import { SignupExperience } from '../signup-experience'

export default function ApplyPage() {
  const params = useParams()
  const slug = params?.slug as string
  return <SignupExperience slug={slug} variant="page" />
}
