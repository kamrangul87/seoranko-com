// Re-exports the singleton so all existing createClient() callers
// get the same shared instance.
import { getSupabaseClient } from '@/lib/supabase-client'

export const createClient = getSupabaseClient
