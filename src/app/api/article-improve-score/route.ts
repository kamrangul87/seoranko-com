import { NextRequest } from 'next/server';
import {
  improveEEAT,
  improveReadability,
  improveHumanScore,
  improveKeywordDensity,
  calculateEEATScore,
  calculateReadabilityScore,
  calculateKeywordDensity,
  scoreHtmlLocally,
} from '@/lib/content-scorer';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      articleHtml = '',
      scoreType = '',
      currentScore = 0,
      primaryKeyword = '',
      market = 'United Kingdom',
    } = body;

    if (!articleHtml || !scoreType) {
      return new Response(
        JSON.stringify({ error: 'articleHtml and scoreType are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[article-improve-score] scoreType=${scoreType} currentScore=${currentScore} keyword="${primaryKeyword}"`);

    let result: { html: string; score: number; summary: string };

    switch (scoreType) {
      case 'eeat':
        result = await improveEEAT(articleHtml, currentScore);
        break;
      case 'readability':
        result = await improveReadability(articleHtml, currentScore);
        break;
      case 'human':
        result = await improveHumanScore(articleHtml);
        break;
      case 'keyword':
        result = await improveKeywordDensity(articleHtml, primaryKeyword, currentScore);
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unknown scoreType: ${scoreType}. Valid: eeat, readability, human, keyword` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
    }

    // Compute full score suite on updated HTML so dashboard can refresh all rings
    const { searchScore, aiScore } = scoreHtmlLocally(result.html, primaryKeyword);
    const newScores = {
      eeatScore: calculateEEATScore(result.html),
      readabilityScore: calculateReadabilityScore(result.html),
      keywordDensity: calculateKeywordDensity(result.html, primaryKeyword),
      searchScore,
      aiScore,
      // For human scoreType, the result.score IS the humanScore
      humanScore: scoreType === 'human' ? result.score : undefined,
    };

    console.log(`[article-improve-score] done: ${result.summary}`);

    return new Response(
      JSON.stringify({ updatedHtml: result.html, newScores, changesSummary: result.summary }),
      { headers: { 'Content-Type': 'application/json' } },
    );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[article-improve-score]', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Score improvement failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
