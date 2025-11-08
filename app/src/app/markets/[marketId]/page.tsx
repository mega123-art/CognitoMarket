// src/app/markets/[marketId]/page.tsx
import { MarketDetailFeature } from '@/components/prediction-market/market-detail-feature'

// Define the expected shape of the params
interface PageParams {
  marketId: string
}

// FIX: In Next.js 15+, 'params' is a Promise.
// The component must be 'async' and 'params' must be 'await'ed.
export default async function Page({ params }: { params: Promise<PageParams> }) {
  // Await the params promise to get the resolved object
  const { marketId } = await params

  // It's also good practice to handle a missing marketId
  if (!marketId) {
    return <div>Error: Market ID not provided.</div>
  }

  return <MarketDetailFeature marketId={marketId} />
}
