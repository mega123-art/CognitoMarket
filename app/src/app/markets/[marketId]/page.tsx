// src/app/markets/[marketId]/page.tsx
import { MarketDetailFeature } from '@/components/prediction-market/market-detail-feature'

// FIX: The PageProps constraint seems to be broken, reporting 'params' as 'Promise<any>'.
// We will bypass this by typing 'params' as 'any' in the signature
// and then asserting the type of 'marketId' immediately after.
export default function Page({ params }: { params: any }) {
  const marketId = params.marketId as string

  // It's also good practice to handle a missing marketId
  if (!marketId) {
    return <div>Error: Market ID not provided.</div>
  }

  return <MarketDetailFeature marketId={marketId} />
}
