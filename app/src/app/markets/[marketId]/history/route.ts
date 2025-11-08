import { MongoClient } from 'mongodb'
import { NextRequest, NextResponse } from 'next/server'

// IMPORTANT: Add your MONGO_URI to your Vercel/Next.js environment variables
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/'
const DB_NAME = 'prediction_market'
const COLLECTION_NAME = 'market_history'

let client: MongoClient
let clientPromise: Promise<MongoClient>

// Setup a cached MongoDB connection
if (!process.env.MONGO_URI) {
  throw new Error('Please define the MONGO_URI environment variable')
}

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  // @ts-ignore
  if (!global._mongoClientPromise) {
    client = new MongoClient(MONGO_URI)
    // @ts-ignore
    global._mongoClientPromise = client.connect()
  }
  // @ts-ignore
  clientPromise = global._mongoClientPromise
} else {
  // In production mode, it's best to not use a global variable.
  client = new MongoClient(MONGO_URI)
  clientPromise = client.connect()
}

export async function GET(request: NextRequest, { params }: { params: { marketId: string } }) {
  const { marketId } = params

  if (!marketId) {
    return NextResponse.json({ error: 'Market ID is required' }, { status: 400 })
  }

  try {
    const mongoClient = await clientPromise
    const db = mongoClient.db(DB_NAME)
    const collection = db.collection(COLLECTION_NAME)

    // Find all history points for the given market, sorted by time
    const history = await collection
      .find({
        market_pubkey: marketId,
      })
      .sort({ timestamp: 1 })
      .toArray()

    return NextResponse.json(history)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Failed to fetch market history' }, { status: 500 })
  }
}
