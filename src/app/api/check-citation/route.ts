/**
 * Retired product surface — always 410 Gone (no processing).
 */
import { goneLegacy } from '@/lib/api-gone'

export const dynamic = 'force-dynamic'

function gone() {
  return goneLegacy('Citation check')
}

export async function GET() {
  return gone()
}

export async function POST() {
  return gone()
}

export async function PUT() {
  return gone()
}

export async function PATCH() {
  return gone()
}

export async function DELETE() {
  return gone()
}
