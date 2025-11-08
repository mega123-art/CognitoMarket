// src/lib/prediction-market-program.ts
import { AnchorProvider, Program } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import idl from './idl.json' // Your IDL

// This is the program ID you provided
export const PREDICTION_MARKET_PROGRAM_ID = new PublicKey('3AewMiJK7RdtsQAsMbY4vk2d4b8Uksfvrr95v2xeGsUc')

// Helper function to get the program
export const getPredictionMarketProgram = (provider: AnchorProvider) => {
  return new Program(idl as any, provider)
}
