import { redirect } from 'next/navigation'

export default function ImagesPage() {
  redirect('/dashboard?tab=images')
}
