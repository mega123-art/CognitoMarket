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
const FEE_VAULT_SEED = Buffer.from('fee_vault') // <-- FIX 1: Add FEE_VAULT_SEED

export function usePredictionMarket() {
  const { cluster } = useCluster()
  const provider = useAnchorProvider()
  const program = getPredictionMarketProgram(provider)
  const client = useQueryClient()
  const transactionToast = useTransactionToast()
  const { publicKey } = useWallet()

  // Find PDAs
  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], program.programId)
  // <-- FIX 2: Add feeVaultPda derivation -->
  const [feeVaultPda] = PublicKey.findProgramAddressSync([FEE_VAULT_SEED], program.programId)

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

  // Get all markets (THIS IS THE MISSING PIECE)
  const getMarkets = useQuery({
    queryKey: ['prediction-market', 'all-markets', { cluster }],
    // @ts-expect-error Anchor IDL type inference issue
    queryFn: () => program.account.market.all(),
  })

  // Get a single market by its ID (which is a u64 BN)
  const useGetMarket = (marketId: BN) => {
    const { marketPda } = findMarketPDAs(marketId)
    return useQuery({
      queryKey: ['prediction-market', 'market', marketId.toString(), { cluster }],
      // @ts-expect-error Anchor IDL type inference issue
      queryFn: () => program.account.market.fetch(marketPda),
    })
  }

  // Get a single market by its public key (RECOMMENDED METHOD)
  const useGetMarketByPubkey = (marketPubkey: PublicKey | null) => {
    return useQuery({
      queryKey: ['prediction-market', 'market', marketPubkey?.toString(), { cluster }],
      queryFn: () => {
        if (!marketPubkey) throw new Error('Market pubkey not provided')
        // MODIFIED: Placed the ts-expect-error directive directly above the line causing the error
        // @ts-expect-error Anchor IDL type inference issue
        return program.account.market.fetch(marketPubkey)
      },
      enabled: !!marketPubkey,
    })
  }

  // Get all positions for the connected user
  const getUserPositions = useQuery({
    queryKey: ['prediction-market', 'user-positions', publicKey?.toBase58(), { cluster }],
    queryFn: () => {
      if (!publicKey) throw new Error('Wallet not connected')
      // @ts-expect-error Anchor IDL type inference issue
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
      // @ts-expect-error Anchor IDL type inference issue
      const market = await program.account.market.fetch(input.marketPubkey)
      const marketId = market.marketId as BN

      const { vaultPda } = findMarketPDAs(marketId)
      const userPositionPda = findUserPositionPDA(marketId, publicKey)

      // Config account is still needed for its bump seeds, but not authority
      // @ts-expect-error Anchor IDL type inference issue
      const config = await program.account.config.fetch(configPda)

      const signature = await program.methods
        .buyShares(input.isYes, input.amountLamports, input.minSharesOut)
        .accounts({
          config: configPda,
          market: input.marketPubkey, // Use the actual pubkey, not derived PDA
          vault: vaultPda,
          feeVault: feeVaultPda, // <-- FIX 3: Add feeVault
          userPosition: userPositionPda,
          user: publicKey,
          // authority: config.authority, // <-- FIX 4: Remove authority
          systemProgram: SystemProgram.programId,
        })
        .rpc()

      // Return both signature and marketPubkey for cache invalidation
      // MODIFIED: Also return 'isYes' to trigger the correct floating element
      return { signature, marketPubkey: input.marketPubkey.toString(), isYes: input.isYes }
    },
    onSuccess: ({ signature, marketPubkey, isYes }) => {
      // MODIFIED: Destructure isYes
      transactionToast(signature)

      // MODIFIED: Dispatch custom event to trigger floating element
      const event = new CustomEvent('newBuy', {
        detail: { type: isYes ? 'yes' : 'no' },
      })
      document.dispatchEvent(event)

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
        .claimWinnings() // <-- FIX 5: Remove marketId argument
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
    getMarkets, // <-- FIX 6: Ensure getMarkets is returned
    useGetMarket,
    useGetMarketByPubkey,
    getUserPositions,
    buyShares,
    claimWinnings,
  }
}
