// Predicts how long to reach target position using rank history trajectory
// Gap: no open source or affordable tool forecasts position over time

import { createClient } from '@supabase/supabase-js'

export interface VelocityPrediction {
  keyword: string
  currentPosition: number | null
  targetPosition: number
  weeklyVelocity: number
  predictedWeeksToTarget: number | null
  predictedDateToTarget: string | null
  confidenceLevel: 'high' | 'medium' | 'low'
  trajectory: 'improving' | 'stable' | 'dropping'
  whatIfScenarios: WhatIfScenario[]
  historyPoints: Array<{ position: number | null; checkedAt: string }>
}

export interface WhatIfScenario {
  action: string
  estimatedBoost: number
  newPredictedWeeks: number | null
}

function computeVelocity(history: Array<{ position: number | null; checked_at: string }>): number {
  const validHistory = history
    .filter(h => h.position !== null)
    .sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime())

  if (validHistory.length < 2) return 0

  const recent = validHistory.slice(-4)
  let totalChange = 0
  let periods = 0

  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1].position!
    const curr = recent[i].position!
    totalChange += prev - curr
    periods++
  }

  return periods > 0 ? totalChange / periods : 0
}

export async function predictRankingVelocity(
  articleId: string,
  keyword: string,
  targetPosition: number = 10,
  currentScores?: { eeat?: number; readability?: number; humanScore?: number; factDensity?: number }
): Promise<VelocityPrediction> {

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: history } = await supabase
    .from('rank_history')
    .select('position, checked_at')
    .eq('ranking_article_id', articleId)
    .order('checked_at', { ascending: true })

  const { data: tracked } = await supabase
    .from('ranking_agent_articles')
    .select('current_position')
    .eq('id', articleId)
    .single()

  const currentPosition = tracked?.current_position || null
  const historyPoints = (history || []).map(h => ({
    position: h.position,
    checkedAt: h.checked_at
  }))

  const weeklyVelocity = computeVelocity(history || [])

  const trajectory: 'improving' | 'stable' | 'dropping' =
    weeklyVelocity > 0.5 ? 'improving' :
    weeklyVelocity < -0.5 ? 'dropping' : 'stable'

  let predictedWeeksToTarget: number | null = null
  let predictedDateToTarget: string | null = null

  if (currentPosition !== null && weeklyVelocity > 0) {
    const positionsNeeded = currentPosition - targetPosition
    if (positionsNeeded <= 0) {
      predictedWeeksToTarget = 0
    } else {
      predictedWeeksToTarget = Math.ceil(positionsNeeded / weeklyVelocity)
      const targetDate = new Date()
      targetDate.setDate(targetDate.getDate() + (predictedWeeksToTarget * 7))
      predictedDateToTarget = targetDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    }
  }

  const confidenceLevel: 'high' | 'medium' | 'low' =
    (history?.length || 0) >= 8 ? 'high' :
    (history?.length || 0) >= 4 ? 'medium' : 'low'

  const whatIfScenarios: WhatIfScenario[] = []

  if (currentScores?.eeat && currentScores.eeat < 90) {
    const boost = Math.round((90 - currentScores.eeat) / 10 * 2)
    const newWeeks = predictedWeeksToTarget && weeklyVelocity > 0
      ? Math.ceil((currentPosition! - targetPosition) / (weeklyVelocity + boost / 4))
      : null
    whatIfScenarios.push({
      action: `Improve EEAT from ${currentScores.eeat} to 90`,
      estimatedBoost: boost,
      newPredictedWeeks: newWeeks
    })
  }

  if (currentScores?.humanScore && currentScores.humanScore < 85) {
    const boost = Math.round((85 - currentScores.humanScore) / 15 * 3)
    whatIfScenarios.push({
      action: `Improve Human Score from ${currentScores.humanScore} to 85`,
      estimatedBoost: boost,
      newPredictedWeeks: predictedWeeksToTarget ? Math.max(1, predictedWeeksToTarget - Math.ceil(boost / 2)) : null
    })
  }

  whatIfScenarios.push({
    action: 'Add 3 more cluster articles linking to this page',
    estimatedBoost: 3,
    newPredictedWeeks: predictedWeeksToTarget ? Math.max(1, predictedWeeksToTarget - 2) : null
  })

  return {
    keyword,
    currentPosition,
    targetPosition,
    weeklyVelocity: Math.round(weeklyVelocity * 10) / 10,
    predictedWeeksToTarget,
    predictedDateToTarget,
    confidenceLevel,
    trajectory,
    whatIfScenarios,
    historyPoints
  }
}
