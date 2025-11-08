// src/lib/prediction-market-data-access.tsx
'use client'

import { useAnchorProvider } from '@/components/solana/solana-provider'
import { getPredictionMarketProgram } from './prediction-market-program'
import { useWallet } from '@solana/wallet-adapter-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCluster } from '@/components/cluster/cluster-data-access'
import { useTransactionToast } from '@/components/use-transaction-toast'
import { BN } from '@coral-xyz/anchor'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import { toast } from 'sonner'

// Seeds for PDA derivation
const CONFIG_SEED = Buffer.from('config')
const MARKET_SEED = Buffer.from('market')
const VAULT_SEED = Buffer.from('vault')
const USER_POSITION_SEED = Buffer.from('position')

export function usePredictionMarket() {
  const { cluster } = useCluster()
  const provider = useAnchorProvider()
  const program = getPredictionMarketProgram(provider)
  const client = useQueryClient()
  const transactionToast = useTransactionToast()
  const { publicKey } = useWallet()

  // Find PDAs
  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], program.programId)

  const findMarketPDAs = (marketId: BN) => {
    const marketIdBytes = marketId.toArrayLike(Buffer, 'le', 8)
    const [marketPda] = PublicKey.findProgramAddressSync([MARKET_SEED, marketIdBytes], program.programId)
    const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED, marketIdBytes], program.programId)
    return { marketPda, vaultPda }
  }

  const findUserPositionPDA = (marketId: BN, user: PublicKey) => {
    const marketIdBytes = marketId.toArrayLike(Buffer, 'le', 8)
    const [userPositionPda] = PublicKey.findProgramAddressSync(
      [USER_POSITION_SEED, user.toBuffer(), marketIdBytes],
      program.programId,
    )
    return userPositionPda
  }

  // === QUERIES ===

  // Get all markets
  const getMarkets = useQuery({
    queryKey: ['prediction-market', 'all-markets', { cluster }],
    // @ts-ignore
    queryFn: () => program.account.market.all(),
  })

  // Get a single market by its ID (which is a u64 BN)
  const useGetMarket = (marketId: BN) => {
    const { marketPda } = findMarketPDAs(marketId)
    return useQuery({
      queryKey: ['prediction-market', 'market', marketId.toString(), { cluster }],
      // @ts-ignore
      queryFn: () => program.account.market.fetch(marketPda),
    })
  }

  // Get a single market by its public key (RECOMMENDED METHOD)
  const useGetMarketByPubkey = (marketPubkey: PublicKey) => {
    return useQuery({
      queryKey: ['prediction-market', 'market', marketPubkey.toString(), { cluster }],
      // @ts-ignore
      queryFn: () => program.account.market.fetch(marketPubkey),
    })
  }

  // Get all positions for the connected user
  const getUserPositions = useQuery({
    queryKey: ['prediction-market', 'user-positions', publicKey?.toBase58(), { cluster }],
    queryFn: () => {
      if (!publicKey) throw new Error('Wallet not connected')
      // @ts-ignore
      return program.account.userPosition.all([
        {
          memcmp: {
            offset: 8, // 8-byte discriminator
            bytes: publicKey.toBase58(),
          },
        },
      ])
    },
    enabled: !!publicKey,
  })

  // === MUTATIONS ===

  // buy_shares - Using market pubkey directly
  const buyShares = useMutation({
    mutationKey: ['prediction-market', 'buy-shares', { cluster, publicKey }],
    mutationFn: async (input: { marketPubkey: PublicKey; isYes: boolean; amountLamports: BN; minSharesOut: BN }) => {
      if (!publicKey) throw new Error('Wallet not connected')

      // Fetch the market to get its marketId for deriving other PDAs
      // @ts-ignore
      const market = await program.account.market.fetch(input.marketPubkey)
      const marketId = market.marketId as BN

      const { vaultPda } = findMarketPDAs(marketId)
      const userPositionPda = findUserPositionPDA(marketId, publicKey)

      // We need the authority from the config account to receive fees
      // @ts-ignore
      const config = await program.account.config.fetch(configPda)

      const signature = await program.methods
        .buyShares(input.isYes, input.amountLamports, input.minSharesOut)
        .accounts({
          config: configPda,
          market: input.marketPubkey, // Use the actual pubkey, not derived PDA
          vault: vaultPda,
          userPosition: userPositionPda,
          user: publicKey,
          authority: config.authority, // Fee receiver
          systemProgram: SystemProgram.programId,
        })
        .rpc()

      // Return both signature and marketPubkey for cache invalidation
      return { signature, marketPubkey: input.marketPubkey.toString() }
    },
    onSuccess: ({ signature, marketPubkey }) => {
      transactionToast(signature)
      // Invalidate queries to refetch data
      client.invalidateQueries({
        queryKey: ['prediction-market', 'market', marketPubkey],
      })
      client.invalidateQueries({
        queryKey: ['prediction-market', 'user-positions', publicKey?.toBase58()],
      })
    },
    onError: (err) => {
      toast.error(`Transaction failed: ${err.message}`)
    },
  })

  // claim_winnings
  const claimWinnings = useMutation({
    mutationKey: ['prediction-market', 'claim-winnings', { cluster, publicKey }],
    mutationFn: async (input: { marketId: BN }) => {
      if (!publicKey) throw new Error('Wallet not connected')

      const { marketPda, vaultPda } = findMarketPDAs(input.marketId)
      const userPositionPda = findUserPositionPDA(input.marketId, publicKey)

      const signature = await program.methods
        .claimWinnings()
        .accounts({
          market: marketPda,
          vault: vaultPda,
          userPosition: userPositionPda,
          user: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
      return signature
    },
    onSuccess: (signature) => {
      transactionToast(signature)
      client.invalidateQueries({
        queryKey: ['prediction-market', 'user-positions', publicKey?.toBase58()],
      })
    },
    onError: (err) => {
      toast.error(`Transaction failed: ${err.message}`)
    },
  })

  return {
    program,
    getMarkets,
    useGetMarket,
    useGetMarketByPubkey,
    getUserPositions,
    buyShares,
    claimWinnings,
  }
}
