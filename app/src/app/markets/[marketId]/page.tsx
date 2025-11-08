// src/app/markets/[marketId]/page.tsx
import { MarketDetailFeature } from '@/components/prediction-market/market-detail-feature'

export default function Page({ params }: { params: { marketId: string } }) {
  return <MarketDetailFeature marketId={params.marketId} />
}
