/**
 * Master-only gate for the one-run Fix Agent UI + routes.
 * Non-master accounts keep the per-finding fix flow.
 */

import { isMasterUserEmail } from '@/lib/stripe/entitlements'

/** True when this session may start/tick the one-run Fix Agent. */
export function canRunFixAgent(email: string | null | undefined): boolean {
  return isMasterUserEmail(email)
}

/** Whether the findings page should render the "Fix my site" control. */
export function shouldShowFixMySiteButton(canRun: boolean): boolean {
  return canRun === true
}
