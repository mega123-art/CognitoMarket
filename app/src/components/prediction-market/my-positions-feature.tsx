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
import { Key } from 'react'

export function MyPositionsFeature() {
  const { getUserPositions, claimWinnings, getMarket } = usePredictionMarket()
  const { publicKey } = useWallet()

  if (!publicKey) {
    return (
      <div className="hero py-[64px]">
        <div className="hero-content text-center">
          <WalletButton />
        </div>
      </div>
    )
  }

  return (
    <div>
      <AppHero title="My Positions" subtitle="View your shares and claim winnings." />

      {getUserPositions.isLoading && <div>Loading positions...</div>}
      {getUserPositions.isError && (
        <div className="alert alert-error">Error loading positions: {getUserPositions.error.message}</div>
      )}

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
              {getUserPositions.data?.map((pos: { account: any; publicKey: { toString: () => Key | null | undefined } }) => {
                const position = pos.account as any // Cast

                return (
                  <TableRow key={pos.publicKey.toString()}>
                    <TableCell>{position.marketId.toString()}</TableCell>
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
function ClaimButton({ marketId, position }: { marketId: BN; position: any }) {
  const { getMarket, claimWinnings } = usePredictionMarket()
  const { data: market } = getMarket(marketId)

  const canClaim =
    market &&
    market.resolved &&
    !position.claimed &&
    ((market.outcome && position.yesShares > 0) || (!market.outcome && position.noShares > 0))

  const handleClaim = () => {
    claimWinnings.mutateAsync({ marketId })
  }

  if (!market || !market.resolved || position.claimed) {
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
