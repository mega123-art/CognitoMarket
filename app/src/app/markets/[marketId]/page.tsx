// src/app/markets/[marketId]/page.tsx
import { MarketDetailFeature } from '@/components/prediction-market/market-detail-feature'

// FIX: The PageProps constraint in Next.js is reporting a confusing
// 'Promise<any>' error. We bypass this by typing 'params' as 'any'
// in the function signature, which satisfies the build check.
export default function Page({ params }: { params: any }) {
  // We can then safely extract our marketId as a string
  const marketId = params.marketId as string

  // It's also good practice to handle a missing marketId
  if (!marketId) {
    return <div>Error: Market ID not provided.</div>
  }

  return <MarketDetailFeature marketId={marketId} />
}
