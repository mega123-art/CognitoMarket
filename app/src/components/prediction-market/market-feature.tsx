// src/components/prediction-market/market-feature.tsx
'use client'

import { usePredictionMarket } from '@/lib/prediction-market-data-access'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import Link from 'next/link'
import { Button } from '../ui/button'
import { AppHero } from '../app-hero'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { Key } from 'react'

// Helper to calculate price
function getPrice(yesLiquidity: bigint, noLiquidity: bigint): number {
  if (yesLiquidity === 0n || noLiquidity === 0n) return 0.5
  const price = Number(yesLiquidity) / (Number(yesLiquidity) + Number(noLiquidity))
  return price
}

export function MarketFeature() {
  const { getMarkets } = usePredictionMarket()

  return (
    <div>
      <AppHero title="Cognitomarket" subtitle="Decentralized Prediction Markets" />
      {getMarkets.isLoading && <div>Loading markets...</div>}
      {getMarkets.isError && <div className="alert alert-error">Error loading markets: {getMarkets.error.message}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {getMarkets.data?.map((market: { account: any; publicKey: { toString: () => Key | null | undefined } }) => {
          const marketAccount = market.account as any // Cast to any to access IDL fields
          const price = getPrice(marketAccount.yesLiquidity, marketAccount.noLiquidity)
          const isResolved = marketAccount.resolved

          return (
            <Card key={market.publicKey.toString()} className="flex flex-col justify-between">
              <CardHeader>
                <CardTitle className="flex justify-between items-center">
                  <span>{marketAccount.question}</span>
                  <span
                    className={`text-lg font-bold ${
                      isResolved ? 'text-gray-500' : price > 0.5 ? 'text-green-500' : 'text-red-500'
                    }`}
                  >
                    {isResolved ? (marketAccount.outcome ? 'YES' : 'NO') : `${(price * 100).toFixed(0)}%`}
                  </span>
                </CardTitle>
                <CardDescription>{marketAccount.category}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{marketAccount.description}</p>
                <div className="text-xs text-muted-foreground mt-2">
                  Volume: {(Number(marketAccount.totalVolume) / LAMPORTS_PER_SOL).toFixed(2)} SOL
                </div>
              </CardContent>
              <CardFooter>
                <Button asChild variant="outline" className="w-full">
                  {/* Use the public key instead of marketId for the URL */}
                  <Link href={`/markets/${market.publicKey.toString()}`}>
                    {isResolved ? 'View Resolution' : 'Trade'}
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
