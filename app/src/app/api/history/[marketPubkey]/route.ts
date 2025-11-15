// src/app/api/history/[marketPubkey]/route.ts
export const dynamic = 'force-dynamic'

import { MongoClient } from 'mongodb'
import { NextResponse } from 'next/server'

// Ensure we have a Mongo URI
if (!process.env.MONGO_URI) {
  throw new Error('Please define the MONGO_URI environment variable')
}

// Cache the MongoDB client for better performance
let cachedClient: MongoClient | null = null

async function connectToDatabase() {
  if (cachedClient) {
    return cachedClient.db('prediction_market_again') // Use your DB name
  }

  const client = await MongoClient.connect(process.env.MONGO_URI!)
  cachedClient = client
  return client.db('prediction_market_again') // Use your DB name
}

// --- FIX: Define an explicit interface for the context object ---
interface RouteContext {
  params: {
    marketPubkey: string
  }
}

// We use the explicit interface for the second argument
export async function GET(request: Request, context: RouteContext) {
  const marketPubkey = context.params.marketPubkey

  if (!marketPubkey) {
    return NextResponse.json({ error: 'Market Pubkey is required' }, { status: 400 })
  }

  try {
    const db = await connectToDatabase()
    const historyCollection = db.collection('market_history')

    const historyData = await historyCollection
      .find(
        { market_pubkey: marketPubkey },
        // Projection: only get the fields we need
        { projection: { _id: 0, yes_liquidity: 1, no_liquidity: 1, timestamp: 1 } },
      )
      .sort({ timestamp: 1 }) // Sort by timestamp ascending
      .toArray()

    return NextResponse.json(historyData)
  } catch (e) {
    console.error('API Error:', e)
    return NextResponse.json({ error: 'Failed to fetch market history' }, { status: 500 })
  }
}
