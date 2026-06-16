/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { keyword, url } = body;

  const login = process.env.DATAFORSEO_EMAIL;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    return NextResponse.json({ error: 'No DataForSEO credentials found' });
  }

  try {
    const response = await fetch(
      'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          keyword,
          location_code: 2826,
          language_code: 'en',
          depth: 50,
        }]),
      }
    );

    const data = await response.json();

    const task = data?.tasks?.[0];
    const result = task?.result?.[0];
    const items = result?.items ?? [];

    const organicItems = items
      .filter((i: any) => i.type === 'organic')
      .map((i: any) => ({
        position: i.rank_absolute,
        domain: i.domain,
        url: i.url,
        title: i.title?.slice(0, 60),
      }));

    // Find target URL in results
    const targetDomain = url
      ?.replace('https://', '')
      ?.replace('http://', '')
      ?.replace('www.', '')
      ?.split('/')[0];

    const found = organicItems.find((i: any) =>
      i.domain?.includes(targetDomain) ||
      i.url?.includes(targetDomain)
    );

    return NextResponse.json({
      keyword,
      targetUrl: url,
      targetDomain,
      taskStatus: task?.status_message,
      totalItems: items.length,
      organicItems: organicItems.slice(0, 20),
      foundAt: found || 'NOT FOUND IN TOP 50',
      credentials: {
        login: login?.slice(0, 5) + '***',
        hasPassword: !!password,
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message });
  }
}
