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

// FIX: Define a type for the market account to avoid 'any'
interface MarketAccount {
  question: string
  description: string
  category: string
  yesLiquidity: bigint
  noLiquidity: bigint
  totalVolume: bigint
  resolved: boolean
  outcome: boolean | null
}

// FIX: Define a type for the market prop
interface MarketProp {
  account: MarketAccount
  publicKey: {
    toString: () => Key | null | undefined
  }
}

export function MarketFeature() {
  const { getMarkets } = usePredictionMarket()

  return (
    <div>
      <AppHero title="Cognitomarket" subtitle="Decentralized Prediction Markets" />
      {getMarkets.isLoading && <div>Loading markets...</div>}
      {getMarkets.isError && <div className="alert alert-error">Error loading markets: {getMarkets.error.message}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* FIX: Use the specific MarketProp type */}
        {getMarkets.data?.map((market: MarketProp) => {
          {
            /* FIX: Remove 'as any' since the type is now correct */
          }
          const marketAccount = market.account
          const yesPrice = getPrice(marketAccount.yesLiquidity, marketAccount.noLiquidity)
          const noPrice = 1 - yesPrice
          const isResolved = marketAccount.resolved

          return (
            <Card key={market.publicKey.toString()} className="flex flex-col justify-between">
              <CardHeader>
                <CardTitle className="flex justify-between items-start gap-2">
                  <span className="flex-1">{marketAccount.question}</span>
                  {isResolved ? (
                    <span className="text-lg font-bold text-gray-500 shrink-0">
                      {marketAccount.outcome ? 'YES' : 'NO'}
                    </span>
                  ) : (
                    <div className="flex flex-col items-end shrink-0">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">YES</span>
                        <span className="text-lg font-bold text-green-500">{(yesPrice * 100).toFixed(0)}¢</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">NO</span>
                        <span className="text-lg font-bold text-red-500">{(noPrice * 100).toFixed(0)}¢</span>
                      </div>
                    </div>
                  )}
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
