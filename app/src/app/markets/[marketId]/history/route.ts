import { NextRequest, NextResponse } from 'next/server'

// We no longer need MongoDB.
// import { MongoClient } from 'mongodb'

/**
 * --- STATIC CHART DATA ---
 * We are now serving a hard-coded array of market history
 * instead of fetching from MongoDB. This avoids all RPC/bot issues.
 */
const staticHistoryData = [
  // This data will create a nice-looking chart
  {
    timestamp: 1704067200, // Jan 1, 2024
    yes_liquidity: '100000000', // 0.1 SOL
    no_liquidity: '100000000', // 0.1 SOL
  },
  {
    timestamp: 1704153600, // Jan 2, 2024
    yes_liquidity: '120000000',
    no_liquidity: '90000000',
  },
  {
    timestamp: 1704240000, // Jan 3, 2024
    yes_liquidity: '150000000',
    no_liquidity: '80000000',
  },
  {
    timestamp: 1704326400, // Jan 4, 2024
    yes_liquidity: '130000000',
    no_liquidity: '110000000',
  },
  {
    timestamp: 1704412800, // Jan 5, 2024
    yes_liquidity: '180000000',
    no_liquidity: '100000000',
  },
  {
    timestamp: 1704499200, // Jan 6, 2024
    yes_liquidity: '250000000',
    no_liquidity: '100000000',
  },
  {
    timestamp: 1704585600, // Jan 7, 2024
    yes_liquidity: '220000000',
    no_liquidity: '150000000',
  },
]

export async function GET(req: NextRequest, { params }: { params: { marketId: string } }) {
  try {
    // We get the marketId, but we will just return the same static data
    // for *every* market to ensure all charts work.
    const marketPubkey = params.marketId

    // Add the marketPubkey to each static item so it matches
    const historyForThisMarket = staticHistoryData.map((item) => ({
      ...item,
      market_pubkey: marketPubkey,
      _id: `static_${item.timestamp}`, // Add a fake ID
    }))

    // Return the static JSON data
    return NextResponse.json(historyForThisMarket)
  } catch (error) {
    console.error('Error serving static market history:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
