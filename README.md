# Cognito Market 🔮

> AI-Powered Decentralized Prediction Markets on Solana

Cognito Market is a fully decentralized prediction market platform built on Solana that uses AI to generate market questions and resolve outcomes. Features real-time price discovery through an automated market maker (AMM), with a brutalist UI design inspired by Web3 aesthetics.

![Cognito Market](https://img.shields.io/badge/Solana-Devnet-purple) ![Next.js](https://img.shields.io/badge/Next.js-15-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue) ![Anchor](https://img.shields.io/badge/Anchor-0.30-orange)

## 🌐 Live Demo

**Visit the live application:** [https://cognito-market.vercel.app](https://cognito-market.vercel.app)

Connect your Solana wallet and start trading on AI-generated prediction markets!

### Quick Start (Try the Live App)

1. **Get a Solana Wallet**
   - Install [Phantom](https://phantom.app/), [Solflare](https://solflare.com/), or [Backpack](https://backpack.app/)

2. **Get Devnet SOL**
   - Switch your wallet to Devnet
   - Visit [Solana Faucet](https://faucet.solana.com/) or use the airdrop button in the app

3. **Start Trading**
   - Browse active markets
   - Click "Trade" to buy YES or NO shares
   - Watch real-time price updates
   - Claim winnings after market resolution

## ✨ Features

### Core Functionality
- **AI-Generated Markets**: Groq LLaMA 3.3 creates unique prediction market questions
- **Automated Market Maker**: Constant product AMM (x * y = k) for efficient price discovery
- **Real-Time Price Charts**: Live trading data visualization with Recharts
- **Smart Resolution**: AI-powered market outcome resolution with confidence scoring
- **Trade History**: Complete transaction tracking with MongoDB
- **User Positions**: Track your holdings across all markets

### Technical Highlights
- **Solana Smart Contracts**: Built with Anchor framework
- **Next.js 15**: Server-side rendering and API routes
- **Real-Time Updates**: React Query for efficient data fetching
- **Wallet Integration**: Solana Wallet Adapter support
- **MongoDB Backend**: Transaction history and market data storage
- **Helius Integration**: Enhanced RPC performance and parsing

## 🎨 Design Philosophy

Cognito Market features a **neobrutalist** design with:
- Sharp edges and no rounded corners
- High contrast color schemes (Light: Pink/Cyan, Dark: Black/Yellow/Green)
- Bold typography using Geist Sans and Geist Mono
- Offset box shadows for depth
- Glitch effects and floating animations
- Brutalist wallet button styling

## 🏗️ Architecture

### Frontend (`/app`)
```
app/
├── src/
│   ├── app/                    # Next.js 15 app router
│   │   ├── api/                # API routes
│   │   │   └── history/        # Market history endpoint
│   │   ├── markets/[marketId]/ # Market detail pages
│   │   ├── positions/          # User positions page
│   │   └── account/            # Wallet management
│   ├── components/
│   │   ├── prediction-market/  # Market components
│   │   ├── ui/                 # shadcn/ui components
│   │   └── cluster/            # Solana cluster management
│   └── lib/
│       ├── prediction-market-data-access.tsx
│       ├── prediction-market-program.ts
│       └── idl.json            # Anchor IDL
```

### Smart Contracts (`/programs`)
```
programs/capstone2/src/
└── lib.rs                      # Anchor program
    ├── initialize()            # Setup protocol
    ├── create_market()         # Deploy new market
    ├── buy_shares()            # Purchase YES/NO shares
    ├── resolve_market()        # Set outcome
    ├── claim_winnings()        # Collect rewards
    └── withdraw_fees()         # Protocol fee collection
```

### Backend (`/backend`)
```
backend/
├── main.py                     # AI bot and indexer
├── withdraw.py                 # Fee withdrawal utility
└── .env                        # Configuration
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Rust 1.70+
- Solana CLI 1.18+
- Anchor CLI 0.30+
- MongoDB 6.0+
- Python 3.11+ (for backend)

### Installation

#### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/cognito-market.git
cd cognito-market
```

#### 2. Install Frontend Dependencies
```bash
cd app
npm install
```

#### 3. Install Backend Dependencies
```bash
cd ../backend
pip install -r requirements.txt
# or
poetry install
```

#### 4. Build Smart Contracts
```bash
cd ../programs
anchor build
```

### Configuration



#### Backend Environment (`.env`)
```env
SOLANA_RPC_URL=https://api.devnet.solana.com/
MONGO_URI=mongodb://localhost:27017/
GROQ_API_KEY=your_groq_api_key_here
HELIUS_API_KEY=your_helius_api_key_here
HELIUS_ENDPOINT=https://api-devnet.helius-rpc.com/
PRIVATE_KEY_BYTES=[your,secret,key,bytes]
```

### Deployment

#### Deploy Smart Contract
```bash
# Build program
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Update program ID in lib.rs and Anchor.toml
```

#### Run Frontend
```bash
cd app
npm run dev
# Open http://localhost:3000
```

#### Run Backend Bot
```bash
cd backend
python main.py
```

## 📊 Smart Contract Details

### Program ID
```
CogMUfHjP4A9Lx6M94D6CCjEytxZuaB1uy1AaHQoq3KV
```

### Key Accounts

#### Config Account
```rust
pub struct Config {
    pub authority: Pubkey,        // Protocol admin
    pub market_count: u64,        // Total markets created
    pub fee_percentage: u16,      // Fee in basis points (200 = 2%)
    pub bump: u8,
    pub fee_vault_bump: u8,
}
```

#### Market Account
```rust
pub struct Market {
    pub market_id: u64,
    pub question: String,         // Max 200 chars
    pub description: String,      // Max 1000 chars
    pub category: String,         // Max 50 chars
    pub yes_liquidity: u64,       // YES pool size
    pub no_liquidity: u64,        // NO pool size
    pub k_constant: u128,         // AMM constant
    pub total_volume: u64,        // Cumulative trading volume
    pub resolved: bool,
    pub outcome: Option<bool>,
    // ... other fields
}
```

#### User Position
```rust
pub struct UserPosition {
    pub user: Pubkey,
    pub market_id: u64,
    pub yes_shares: u64,
    pub no_shares: u64,
    pub claimed: bool,
    pub bump: u8,
}
```

### Fee Structure
- **Trading Fee**: 2% (200 basis points)
- **Initial Liquidity**: 0.1 SOL per side (0.2 SOL total)
- **Market Duration**: 30 minutes (configurable)

## 🤖 AI Backend Bot

The Python bot handles:

1. **Market Generation**: Creates unique questions using Groq API
2. **Duplicate Detection**: Prevents similar questions within 24 hours
3. **Auto-Resolution**: Resolves markets using AI reasoning
4. **Transaction Indexing**: Monitors and stores all trades
5. **Database Sync**: Keeps MongoDB in sync with blockchain

### Bot Configuration
```python
MARKET_DURATION_MINUTES = 30
CHECK_INTERVAL_SECONDS = 60
MARKET_CREATION_INTERVAL_MINUTES = 15
INITIAL_LIQUIDITY_SOL = 0.1
```

## 🎯 AMM Mechanics

### Price Calculation
```
YES Price = YES Liquidity / (YES Liquidity + NO Liquidity)
NO Price = 1 - YES Price
```

### Share Purchase
```
Using constant product formula: x * y = k
- When buying YES: x increases, y decreases
- When buying NO: y increases, x decreases
- Shares received = Old Liquidity - New Liquidity
```

### Example Trade
```
Initial: 0.1 SOL YES, 0.1 SOL NO → 50¢ each
Buy 0.05 SOL YES:
- New YES: 0.15 SOL
- New NO: 0.0667 SOL (k = 0.01)
- Shares: 0.0333 SOL worth
- New YES price: 69.2¢
```

## 📈 API Endpoints

### GET `/api/history/[marketPubkey]`
Returns trade history for a specific market:
```json
[
  {
    "yes_liquidity": "100000000",
    "no_liquidity": "100000000",
    "timestamp": "2024-01-15T10:30:00Z",
    "is_yes": true,
    "shares": "5000000",
    "tx_signature": "5xQ7..."
  }
]
```

## 🎨 UI Components

### Market Card
- Question and description
- Live YES/NO prices
- Category badge
- Volume indicator
- Resolution status

### Market Detail
- Price chart (Recharts)
- Trade interface
- Live trade table
- Market statistics
- Outcome display

### My Positions
- All user holdings
- Claimable winnings
- Position P&L
- Quick links to markets

## 🔐 Security Considerations

- All markets require authority signature to resolve
- PDA-based account derivation prevents unauthorized access
- Slippage protection on all trades
- Rent-exempt account requirements
- Integer overflow protection with checked math

## 🧪 Testing

### Run Anchor Tests
```bash
anchor test
```



## 🛠️ Troubleshooting

### "Account not found" errors
- Ensure program is deployed: `anchor deploy`
- Verify program ID matches in all files
- Check cluster selection (devnet)

### Bot not creating markets
- Verify GROQ_API_KEY is valid
- Check MongoDB connection
- Ensure wallet has sufficient SOL



## 🙏 Acknowledgments

- [Anchor Framework](https://www.anchor-lang.com/)
- [Solana Web3.js](https://solana-labs.github.io/solana-web3.js/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Groq](https://groq.com/) for AI capabilities
- [Helius](https://helius.dev/) for RPC infrastructure


## 🗺️ Roadmap

- [ ] Mainnet deployment
- [ ] Advanced charting tools
- [ ] Mobile app (React Native)
- [ ] Liquidity pools
- [ ] Governance token
- [ ] Market categories expansion
- [ ] Social features (comments, sharing)
- [ ] API for third-party integrations

---

**Built with ❤️ on Solana** | [Live App](https://cognito-market.vercel.app) | [GitHub](https://github.com/yourusername/cognito-market)