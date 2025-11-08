// src/components/prediction-market/market-detail-feature.tsx
'use client'

import { usePredictionMarket } from '@/lib/prediction-market-data-access'
import { BN } from '@coral-xyz/anchor'
import { AppHero } from '../app-hero'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { useState } from 'react'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletButton } from '../solana/solana-provider'

// Helper to calculate price
function getPrice(yesLiquidity: bigint, noLiquidity: bigint): number {
  if (yesLiquidity === 0n || noLiquidity === 0n) return 0.5
  const price = Number(yesLiquidity) / (Number(yesLiquidity) + Number(noLiquidity))
  return price
}

export function MarketDetailFeature({ marketId }: { marketId: string }) {
  const { getMarket, buyShares } = usePredictionMarket()
  const { publicKey } = useWallet()
  const [amountSol, setAmountSol] = useState('0.1')
  const marketIdU64 = new BN(marketId)

  const { data: market, isLoading } = getMarket(marketIdU64)

  const handleBuy = (isYes: boolean) => {
    const amountLamports = new BN(parseFloat(amountSol) * LAMPORTS_PER_SOL)
    buyShares.mutateAsync({
      marketId: marketIdU64,
      isYes,
      amountLamports,
      minSharesOut: new BN(0), // No slippage protection for this example
    })
  }

  if (isLoading) return <div>Loading market...</div>
  if (!market) return <div>Market not found</div>

  const price = getPrice(market.yesLiquidity, market.noLiquidity)
  const isResolved = market.resolved

  return (
    <div>
      <AppHero
        title={market.question}
        subtitle={
          <div className="flex flex-col items-center">
            <p className="text-lg">{market.description}</p>
            <span className="text-sm text-muted-foreground mt-2">
              Resolves: {new Date(Number(market.resolutionTime) * 1000).toLocaleString()}
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Market Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Price</span>
              <span className="font-bold">{(price * 100).toFixed(0)}¢</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Volume</span>
              <span>{(Number(market.totalVolume) / LAMPORTS_PER_SOL).toFixed(4)} SOL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Liquidity</span>
              <span>
                {((Number(market.yesLiquidity) + Number(market.noLiquidity)) / LAMPORTS_PER_SOL).toFixed(4)} SOL
              </span>
            </div>
            {isResolved && (
              <div className="flex justify-between pt-4 text-lg font-bold">
                <span className="text-muted-foreground">Outcome</span>
                <span>{market.outcome ? 'YES' : 'NO'}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trade</CardTitle>
            <CardDescription>Buy shares for YES or NO</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isResolved ? (
              <div className="text-center font-bold text-lg">Market has resolved. Trading is closed.</div>
            ) : !publicKey ? (
              <div className="flex justify-center">
                <WalletButton />
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="amount">Amount (SOL)</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    value={amountSol}
                    onChange={(e) => setAmountSol(e.target.value)}
                    disabled={buyShares.isPending}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="default"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => handleBuy(true)}
                    disabled={buyShares.isPending}
                  >
                    {buyShares.isPending ? 'Buying...' : 'Buy YES'}
                  </Button>
                  <Button
                    variant="default"
                    className="bg-red-600 hover:bg-red-700"
                    onClick={() => handleBuy(false)}
                    disabled={buyShares.isPending}
                  >
                    {buyShares.isPending ? 'Buying...' : 'Buy NO'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
