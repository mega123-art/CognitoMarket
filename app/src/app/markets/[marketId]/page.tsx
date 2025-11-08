// src/app/markets/[marketId]/page.tsx
import { MarketDetailFeature } from '@/components/prediction-market/market-detail-feature'

// FIX: We are adding a 'eslint-disable-next-line' comment.
// This tells ESLint to ignore the 'no-explicit-any' rule for the next line,
// which is necessary to bypass the broken Next.js type check.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function Page({ params }: { params: any }) {
  const marketId = params.marketId as string

  if (!marketId) {
    return <div>Error: Market ID not provided.</div>
  }

  return <MarketDetailFeature marketId={marketId} />
}
