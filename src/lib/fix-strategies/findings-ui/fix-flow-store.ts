/**
 * Findings fix-flow — approve → GitHub PR commit → live verify after deploy.
 * Persistence: Supabase `fix_strategies_fix_flows` (memory fallback for tests).
 */

export {
  getFixFlow,
  approveFix,
  commitFix,
  verifyFix,
} from './fix-flow/orchestrate'
export type { CommitContext } from './fix-flow/orchestrate'
export {
  getFixFlowStore,
  useMemoryFixFlowStore,
  resetMemoryFixFlowStore,
} from './fix-flow/persist'
