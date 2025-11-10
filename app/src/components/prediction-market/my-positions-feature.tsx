// src/components/prediction-market/my-positions-feature.tsx
'use client'

import { usePredictionMarket } from '@/lib/prediction-market-data-access'
import { AppHero } from '../app-hero'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '../ui/button'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletButton } from '../solana/solana-provider'
import { BN } from '@coral-xyz/anchor'
import { Card, CardContent } from '../ui/card'
import { PublicKey } from '@solana/web3.js'
import Link from 'next/link' // Added Link import
import { useMemo } from 'react' // Added useMemo import

// Type definitions for better type safety
interface UserPositionAccount {
  marketId: BN
  yesShares: number
  noShares: number
  claimed: boolean
  user: PublicKey
  bump: number
}

// Added type for the market list
interface MarketAccount {
  marketId: BN
  // ... other market fields
}
interface MarketProp {
  account: MarketAccount
  publicKey: PublicKey
}

interface MarketAccountForClaim {
  resolved: boolean
  outcome: boolean | null
  marketId: BN
}

export function MyPositionsFeature() {
  // MODIFIED: Fetch getMarkets in addition to getUserPositions
  // FIX: Removed trailing underscore
  const { getUserPositions, getMarkets } = usePredictionMarket()
  const { publicKey } = useWallet()

  // MODIFIED: Create a map of marketId.toString() -> marketPubkey.toString()
  const marketIdToPubkeyMap = useMemo(() => {
    if (!getMarkets.data) return new Map<string, string>()

    const map = new Map<string, string>()
    // @ts-expect-error Type from anchor
    getMarkets.data.forEach((market: MarketProp) => {
      const id = market.account.marketId.toString()
      const pk = market.publicKey.toString()
      map.set(id, pk)
    })
    return map
  }, [getMarkets.data])

  if (!publicKey) {
    return (
      <div className="hero py-[64px]">
        <div className="hero-content text-center">
          <WalletButton />
        </div>
      </div>
    )
  }

  // MODIFIED: Wait for both queries to load
  if (getUserPositions.isLoading || getMarkets.isLoading) {
    return <div>Loading positions...</div>
  }

  if (getUserPositions.isError) {
    return <div className="alert alert-error">Error loading positions: {getUserPositions.error.message}</div>
  }

  if (getMarkets.isError) {
    return <div className="alert alert-error">Error loading markets: {getMarkets.error.message}</div>
  }

  return (
    <div>
      <AppHero title="My Positions" subtitle="View your shares and claim winnings." />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Market ID</TableHead>
                <TableHead>Yes Shares</TableHead>
                <TableHead>No Shares</TableHead>
                <TableHead>Claimed</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {getUserPositions.data?.map((pos: { account: UserPositionAccount; publicKey: PublicKey }) => {
                const position = pos.account
                // MODIFIED: Look up the market's public key from the map
                const marketPubkey = marketIdToPubkeyMap.get(position.marketId.toString())

                // If market not found in map (shouldn't happen), don't render row
                if (!marketPubkey) {
                  return null
                }

                return (
                  <TableRow key={pos.publicKey.toString()}>
                    {/* MODIFIED: Use the correct marketPubkey for the link */}
                    <TableCell>
                      <Button asChild variant="link" className="font-mono p-0 h-auto">
                        <Link href={`/markets/${marketPubkey}`}>{position.marketId.toString()}</Link>
                      </Button>
                    </TableCell>
                    <TableCell>{(Number(position.yesShares) / 1_000_000).toFixed(2)}</TableCell>
                    <TableCell>{(Number(position.noShares) / 1_000_000).toFixed(2)}</TableCell>
                    <TableCell>{position.claimed ? 'Yes' : 'No'}</TableCell>
                    <TableCell className="text-right">
                      <ClaimButton marketId={position.marketId} position={position} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// Separate component to fetch market data for the claim button
function ClaimButton({ marketId, position }: { marketId: BN; position: UserPositionAccount }) {
  const { useGetMarket, claimWinnings } = usePredictionMarket()
  const { data: market } = useGetMarket(marketId)

  // @ts-expect-error Type from anchor
  const marketData = market as MarketAccountForClaim | undefined

  const canClaim =
    marketData &&
    marketData.resolved &&
    !position.claimed &&
    ((marketData.outcome && position.yesShares > 0) || (marketData.outcome === false && position.noShares > 0)) // Check for explicit false

  const handleClaim = () => {
    claimWinnings.mutateAsync({ marketId })
  }

  if (!marketData || !marketData.resolved || position.claimed) {
    return (
      <Button variant="outline" size="sm" disabled>
        Claim
      </Button>
    )
  }

  return (
    <Button variant="outline" size="sm" disabled={!canClaim || claimWinnings.isPending} onClick={handleClaim}>
      {claimWinnings.isPending ? 'Claiming...' : 'Claim'}
    </Button>
  )
}
