// src/app/markets/[marketId]/page.tsx
import { MarketDetailFeature } from '@/components/prediction-market/market-detail-feature'

// FIX: Define the full props type for a Next.js Page
type Props = {
  params: { marketId: string }
  searchParams: { [key: string]: string | string[] | undefined }
}

export default function Page({ params }: Props) {
  return <MarketDetailFeature marketId={params.marketId} />
}
