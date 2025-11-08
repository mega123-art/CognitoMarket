import json
import os
import asyncio
import base58
import base64
import struct
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict
from dotenv import load_dotenv
from groq import Groq
from pymongo import MongoClient
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta
from solders.message import MessageV0
from solders.transaction import VersionedTransaction
from solders.hash import Hash
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.rpc import types as rpc_types
from solana.rpc.websocket_api import connect
from solders.rpc.config import RpcTransactionLogsFilterMentions

load_dotenv()

# --- Configuration ---
SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
SOLANA_WS_URL = os.getenv("SOLANA_WS_URL", "wss://api.devnet.solana.com")
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
PRIVATE_KEY_BYTES = os.getenv("PRIVATE_KEY_BYTES")  # Comma-separated byte array or base58
PROGRAM_ID_STR = "3AewMiJK7RdtsQAsMbY4vk2d4b8Uksfvrr95v2xeGsUc"
SYSTEM_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")

# Market creation parameters
INITIAL_LIQUIDITY_SOL = 0.1  # 0.1 SOL per market
MARKET_DURATION_HOURS = 24  # Markets last 24 hours
CHECK_INTERVAL_SECONDS = 120  # Check every 2 minutes for resolution/sweep
MARKET_CREATION_INTERVAL_HOURS = 6  # Create a new market every 6 hours
SWEEP_GRACE_PERIOD_HOURS = 24 # Wait 24h after resolution to sweep funds

# --- Anchor Instruction Discriminators (from IDL) ---
DISCRIMINATORS = {
    "initialize": bytes([175, 175, 109, 31, 13, 152, 155, 237]),
    "create_market": bytes([103, 226, 97, 235, 200, 188, 251, 254]),
    "resolve_market": bytes([155, 23, 80, 173, 46, 74, 23, 239]),
    "sweep_funds": bytes([150, 235, 156, 105, 133, 142, 200, 162]),
}

# Anchor Event Discriminator for 'BuySharesEvent'
# sha256("event:BuySharesEvent")[..8]
EVENT_DISCRIMINATOR_BUY_SHARES = "S+S9q8iA99U="  # Base64 of bytes: [75, 235, 75, 171, 200, 128, 247, 84]

# --- Helper Classes ---
class ConfigAccount:
    """Helper class to hold deserialized Config account data."""
    def __init__(self, authority: Pubkey, market_count: int, fee_percentage: int, bump: int):
        self.authority = authority
        self.market_count = market_count
        self.fee_percentage = fee_percentage
        self.bump = bump

class PredictionMarketBot:
    def __init__(self):
        # Initialize Solana connection
        self.connection = AsyncClient(SOLANA_RPC_URL)
        
        # Load keypair from environment
        self.keypair = self._load_keypair()
        self.authority_pubkey = self.keypair.pubkey()
        
        # Initialize Groq client
        self.groq_client = Groq(api_key=GROQ_API_KEY)
        
        # Initialize MongoDB
        self.mongo_client = MongoClient(MONGO_URI)
        self.db = self.mongo_client["prediction_market"]
        self.markets_collection = self.db["markets"]
        
        # NEW: Collection for chart history
        self.history_collection = self.db["market_history"]
        
        self.markets_collection.create_index("market_id", unique=True)
        self.markets_collection.create_index("resolution_time")
        self.markets_collection.create_index("resolved")
        self.markets_collection.create_index("swept")
        
        # NEW: Indexes for history collection
        self.history_collection.create_index("market_pubkey")
        self.history_collection.create_index("timestamp")
        
        self.program_id = Pubkey.from_string(PROGRAM_ID_STR)
        
        print(f" Bot initialized with authority: {self.authority_pubkey}")
        print(f" Initial liquidity per market: {INITIAL_LIQUIDITY_SOL} SOL")
        print(f"  Market creation interval: {MARKET_CREATION_INTERVAL_HOURS} hours")
        print(f" Sweep grace period: {SWEEP_GRACE_PERIOD_HOURS} hours")

    def _load_keypair(self) -> Keypair:
        raw = PRIVATE_KEY_BYTES
        if not raw:
            raise ValueError("PRIVATE_KEY_BYTES not found in environment")

        s = raw.strip()
        if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
            s = s[1:-1].strip()

        try:
            if s.startswith('[') and s.endswith(']'):
                import json as _json
                parsed = _json.loads(s)
                if isinstance(parsed, list) and all(isinstance(x, int) for x in parsed):
                    secret_key = bytes(parsed)
                else:
                    raise ValueError("JSON array did not contain integers")
            else:
                if all(c.isdigit() or c in ', []' for c in s):
                    cleaned = s.replace('[', '').replace(']', '').strip()
                    bytes_list = [int(b.strip()) for b in cleaned.split(',') if b.strip() != ""]
                    secret_key = bytes(bytes_list)
                else:
                    try:
                        secret_key = base58.b58decode(s)
                    except Exception as e:
                        raise ValueError(f"Could not parse PRIVATE_KEY_BYTES as base58: {e}")
        except Exception as e:
            raise ValueError(f"Failed to load keypair: {e}")

        if len(secret_key) == 64:
            return Keypair.from_bytes(secret_key)
        elif len(secret_key) == 32:
            return Keypair.from_seed(secret_key)
        else:
            raise ValueError(f"Invalid secret key length: {len(secret_key)} (expected 32 or 64 bytes)")

    # --- Serialization & Transaction Helpers ---

    def _serialize_string(self, s: str) -> bytes:
        """Serializes a string Anchor-style (4-byte length prefix + UTF-8 bytes)."""
        s_bytes = s.encode('utf-8')
        return struct.pack('<I', len(s_bytes)) + s_bytes

    async def _send_and_confirm_tx(self, instruction: Instruction) -> str:
        """Builds, signs, sends, and confirms a v0 transaction."""
        blockhash_resp = await self.connection.get_latest_blockhash(commitment=Confirmed)
        recent_blockhash = blockhash_resp.value.blockhash
        
        message = MessageV0.try_compile(
            payer=self.authority_pubkey,
            instructions=[instruction],
            address_lookup_table_accounts=[],
            recent_blockhash=recent_blockhash
        )
        
        tx = VersionedTransaction(message, [self.keypair])
        
        try:
            resp = await self.connection.send_transaction(
                tx, 
                opts=rpc_types.TxOpts(skip_preflight=False, preflight_commitment=Confirmed)
            )
            tx_sig = resp.value
            
            await self.connection.confirm_transaction(
                tx_sig, 
                commitment=Confirmed,
                last_valid_block_height=blockhash_resp.value.last_valid_block_height,
                sleep_seconds=1
            )
            return str(tx_sig)
        except Exception as e:
            print(f"Transaction failed: {e}")
            raise e

    # --- Account Deserialization ---

    async def _get_config_account(self) -> Optional[ConfigAccount]:
        """Fetches and deserializes the program's Config account."""
        config_pda, _ = Pubkey.find_program_address([b"config"], self.program_id)
        account_info = await self.connection.get_account_info(config_pda, commitment=Confirmed)
        
        if not account_info.value:
            return None
        
        data = account_info.value.data
        expected_len = 8 + 32 + 8 + 2 + 1 
        if len(data) < expected_len:
            print(f"Warning: Config account data is too small. Expected {expected_len}, got {len(data)}")
            return None
            
        data_body = data[8:]
        
        try:
            unpacked = struct.unpack('<32sQHB', data_body[:32+8+2+1])
            
            return ConfigAccount(
                authority=Pubkey(unpacked[0]),
                market_count=unpacked[1],
                fee_percentage=unpacked[2],
                bump=unpacked[3]
            )
        except struct.error as e:
            print(f"Failed to unpack Config account: {e}")
            return None

    # --- On-Chain Instruction Implementations ---

    async def initialize_program(self):
        """Initialize the prediction market program (one-time setup)"""
        print("Checking program initialization...")
        config_pda, _ = Pubkey.find_program_address([b"config"], self.program_id)
        
        config_account = await self._get_config_account()
        if config_account:
            print(f" Program already initialized. Authority: {config_account.authority}")
            return

        print("Program not initialized. Sending initialize transaction...")
        try:
            data = DISCRIMINATORS["initialize"]
            
            accounts = [
                AccountMeta(config_pda, is_signer=False, is_writable=True),
                AccountMeta(self.authority_pubkey, is_signer=True, is_writable=True),
                AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
            ]
            
            instruction = Instruction(self.program_id, data, accounts)
            tx_sig = await self._send_and_confirm_tx(instruction)
            print(f" Program initialized: {tx_sig}")
            
        except Exception as e:
            print(f" Initialization error: {e}")

    def generate_market_idea(self) -> Optional[Dict]:
        """Use Groq AI to generate a prediction market idea"""
        try:
            prompt = """Generate a single interesting prediction market question about current events, technology, sports, or culture.

Return ONLY a JSON object with this exact structure (no markdown, no extra text):
{
    "question": "A clear yes/no question under 200 characters",
    "description": "Detailed context and resolution criteria under 1000 characters",
    "category": "One of: Technology, Sports, Politics, Entertainment, Science, Business"
}

Make the question specific, timely, and objectively resolvable."""

            response = self.groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.8,
                max_tokens=500
            )
            
            content = response.choices[0].message.content.strip()
            
            if content.startswith("```json"):
                content = content.split("```json")[1].split("```")[0].strip()
            elif content.startswith("```"):
                content = content.split("```")[1].split("```")[0].strip()
            
            market_data = json.loads(content)
            
            if not all(k in market_data for k in ["question", "description", "category"]):
                raise ValueError("Missing required fields")
            
            return market_data
            
        except Exception as e:
            print(f" Market generation error: {e}")
            return None

    async def create_market_onchain(self, market_data: Dict) -> Optional[int]:
        """Create market on Solana blockchain"""
        try:
            config_pda, _ = Pubkey.find_program_address([b"config"], self.program_id)
            config_account = await self._get_config_account()
            if not config_account:
                raise ValueError("Config account not found. Is program initialized?")
            
            market_id = config_account.market_count
            
            resolution_time = int((datetime.now(timezone.utc) + timedelta(hours=MARKET_DURATION_HOURS)).timestamp())
            
            initial_liquidity = int(INITIAL_LIQUIDITY_SOL * 1_000_000_000)
            
            market_id_bytes = market_id.to_bytes(8, "little")
            market_pda, _ = Pubkey.find_program_address(
                [b"market", market_id_bytes], 
                self.program_id
            )
            vault_pda, _ = Pubkey.find_program_address(
                [b"vault", market_id_bytes], 
                self.program_id
            )
            
            data = DISCRIMINATORS["create_market"]
            data += struct.pack('<Q', market_id)
            data += self._serialize_string(market_data["question"])
            data += self._serialize_string(market_data["description"])
            data += self._serialize_string(market_data["category"])
            data += struct.pack('<q', resolution_time)
            data += struct.pack('<Q', initial_liquidity)

            accounts = [
                AccountMeta(config_pda, is_signer=False, is_writable=True),
                AccountMeta(market_pda, is_signer=False, is_writable=True),
                AccountMeta(vault_pda, is_signer=False, is_writable=True),
                AccountMeta(self.authority_pubkey, is_signer=True, is_writable=True),
                AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
            ]
            
            instruction = Instruction(self.program_id, data, accounts)
            tx_sig = await self._send_and_confirm_tx(instruction)
            
            print(f" Market #{market_id} created on-chain: {tx_sig}")
            return market_id
            
        except Exception as e:
            print(f" On-chain creation error: {e}")
            return None

    async def store_market_in_db(self, market_id: int, market_data: Dict, resolution_time: int):
        """Store market metadata in MongoDB"""
        try:
            document = {
                "market_id": market_id,
                "question": market_data["question"],
                "description": market_data["description"],
                "category": market_data["category"],
                "resolution_time": resolution_time,
                "created_at": datetime.now(timezone.utc),
                "resolved": False,
                "outcome": None,
                "resolution_reasoning": None,
                "resolved_at": None,
                "swept": False
            }
            
            self.markets_collection.insert_one(document)
            print(f" Market #{market_id} stored in database")
            
        except Exception as e:
            print(f" Database storage error: {e}")

    async def create_new_market(self):
        """Full flow: Generate idea → Create on-chain → Store in DB"""
        print("\n Generating new market...")
        
        market_data = self.generate_market_idea()
        if not market_data:
            return
        
        print(f" Question: {market_data['question']}")
        print(f"  Category: {market_data['category']}")
        
        market_id = await self.create_market_onchain(market_data)
        if market_id is None:
            return
        
        resolution_time = int((datetime.now(timezone.utc) + timedelta(hours=MARKET_DURATION_HOURS)).timestamp())
        await self.store_market_in_db(market_id, market_data, resolution_time)
        
        print(f" Market #{market_id} fully created!\n")

    def resolve_market_with_ai(self, market_data: Dict) -> Optional[Dict]:
        """Use Groq AI to determine market outcome"""
        try:
            prompt = f"""You are resolving a prediction market. Based on current information, determine the outcome.

MARKET QUESTION: {market_data['question']}
DESCRIPTION: {market_data['description']}
CATEGORY: {market_data['category']}

Analyze the question and provide a resolution. Return ONLY a JSON object:
{{
    "outcome": true or false (true = YES won, false = NO won),
    "reasoning": "Brief explanation of why this outcome is correct (under 500 chars)",
    "confidence": 0.0 to 1.0 (how confident you are in this resolution)
}}

Be objective and base your decision on verifiable facts. If you cannot determine the outcome with reasonable confidence (>0.6), set confidence to 0.0."""

            response = self.groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=300
            )
            
            content = response.choices[0].message.content.strip()

            if content.startswith("```json"):
                content = content.split("```json")[1].split("```")[0].strip()
            elif content.startswith("```"):
                content = content.split("```")[1].split("```")[0].strip()
            
            resolution = json.loads(content)
            
            if resolution.get("confidence", 0) < 0.6:
                print(f"  Low confidence ({resolution['confidence']}) - skipping resolution")
                return None
            
            return resolution
            
        except Exception as e:
            print(f" AI resolution error: {e}")
            return None

    async def resolve_market_onchain(self, market_id: int, outcome_yes: bool) -> bool:
        """Resolve market on Solana blockchain"""
        try:
            config_pda, _ = Pubkey.find_program_address([b"config"], self.program_id)
            market_id_bytes = market_id.to_bytes(8, "little")
            market_pda, _ = Pubkey.find_program_address(
                [b"market", market_id_bytes], 
                self.program_id
            )
            
            data = DISCRIMINATORS["resolve_market"]
            data += struct.pack('<B', outcome_yes)

            accounts = [
                AccountMeta(config_pda, is_signer=False, is_writable=False),
                AccountMeta(market_pda, is_signer=False, is_writable=True),
                AccountMeta(self.authority_pubkey, is_signer=True, is_writable=True),
            ]

            instruction = Instruction(self.program_id, data, accounts)
            tx_sig = await self._send_and_confirm_tx(instruction)
            
            print(f" Market #{market_id} resolved on-chain: {tx_sig}")
            return True
            
        except Exception as e:
            print(f" On-chain resolution error: {e}")
            return False

    async def sweep_funds_onchain(self, market_id: int) -> bool:
        """Sweep remaining funds from a resolved market's vault."""
        print(f" Sweeping funds from Market #{market_id}...")
        try:
            config_pda, _ = Pubkey.find_program_address([b"config"], self.program_id)
            market_id_bytes = market_id.to_bytes(8, "little")
            market_pda, _ = Pubkey.find_program_address(
                [b"market", market_id_bytes], 
                self.program_id
            )
            vault_pda, _ = Pubkey.find_program_address(
                [b"vault", market_id_bytes], 
                self.program_id
            )
            
            data = DISCRIMINATORS["sweep_funds"]

            accounts = [
                AccountMeta(config_pda, is_signer=False, is_writable=False),
                AccountMeta(market_pda, is_signer=False, is_writable=False),
                AccountMeta(vault_pda, is_signer=False, is_writable=True),
                AccountMeta(self.authority_pubkey, is_signer=True, is_writable=True),
                AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
            ]

            instruction = Instruction(self.program_id, data, accounts)
            tx_sig = await self._send_and_confirm_tx(instruction)

            print(f" Funds swept from Market #{market_id}: {tx_sig}")
            return True

        except Exception as e:
            if "No remaining funds" in str(e) or "6016" in str(e):
                print(f"  No funds to sweep in Market #{market_id}.")
                return True
            
            print(f" On-chain sweep error for Market #{market_id}: {e}")
            return False

    async def check_and_resolve_markets(self):
        """Check for markets that need resolution and resolve them"""
        current_time = datetime.now(timezone.utc)
        current_timestamp = int(current_time.timestamp())
        
        # --- 1. Resolve Markets ---
        markets_to_resolve = self.markets_collection.find({
            "resolved": False,
            "resolution_time": {"$lte": current_timestamp}
        })
        
        for market in markets_to_resolve:
            print(f"\n Market #{market['market_id']} ready for resolution")
            print(f"  Question: {market['question']}")
            
            resolution = self.resolve_market_with_ai(market)
            if not resolution:
                print(f"  Skipped (unable to resolve)")
                continue
            
            outcome_yes = resolution["outcome"]
            print(f"  Outcome: {'YES' if outcome_yes else 'NO'}")
            print(f"  Confidence: {resolution['confidence']:.2%}")
            print(f"  Reasoning: {resolution['reasoning']}")
            
            success = await self.resolve_market_onchain(market["market_id"], outcome_yes)
            
            if success:
                self.markets_collection.update_one(
                    {"market_id": market["market_id"]},
                    {
                        "$set": {
                            "resolved": True,
                            "outcome": outcome_yes,
                            "resolution_reasoning": resolution["reasoning"],
                            "resolved_at": datetime.now(timezone.utc)
                        }
                    }
                )
                print(f"  Resolution complete!")

        # --- 2. Sweep Funds ---
        sweep_cutoff = current_time - timedelta(hours=SWEEP_GRACE_PERIOD_HOURS)
        
        markets_to_sweep = self.markets_collection.find({
            "resolved": True,
            "swept": False,
            "resolved_at": {"$lte": sweep_cutoff}
        })

        for market in markets_to_sweep:
            print(f"\n Market #{market['market_id']} ready for sweeping (resolved at {market['resolved_at']}).")
            
            success = await self.sweep_funds_onchain(market["market_id"])
            
            if success:
                self.markets_collection.update_one(
                    {"market_id": market["market_id"]},
                    {"$set": {"swept": True}}
                )
                print(f"  Sweep complete!")
                
    # --- Event Listener ---
    
    # --- FIX: Corrected parser for string liquidity ---
    def _parse_buy_shares_event(self, log_data: str):
        """
        Parses the base64 data from an Anchor event log.
        Event: BuySharesEvent (from programs/capstone2/src/lib.rs)
        - market_pubkey: Pubkey (32)
        - market_id: u64 (8)
        - user: Pubkey (32)
        - is_yes: bool (1)
        - shares: u64 (8)
        - yes_liquidity: String
        - no_liquidity: String
        - timestamp: i64 (8)
        """
        try:
            # Anchor event data is base64
            data = base64.b64decode(log_data)
            
            # Skip 8-byte discriminator
            data_body = data[8:]
            
            offset = 0
            
            # 1. market_pubkey (32 bytes)
            market_pubkey_bytes = data_body[offset:offset+32]
            market_pubkey = str(Pubkey(market_pubkey_bytes))
            offset += 32
            
            # 2. market_id (8 bytes, u64)
            market_id = struct.unpack_from('<Q', data_body, offset)[0]
            offset += 8
            
            # 3. user (32 bytes)
            user_bytes = data_body[offset:offset+32]
            user = str(Pubkey(user_bytes))
            offset += 32
            
            # 4. is_yes (1 byte, bool)
            is_yes = bool(struct.unpack_from('<B', data_body, offset)[0])
            offset += 1
            
            # 5. shares (8 bytes, u64)
            shares = struct.unpack_from('<Q', data_body, offset)[0]
            offset += 8
            
            # 6. yes_liquidity (String)
            yes_len = struct.unpack_from('<I', data_body, offset)[0]
            offset += 4
            yes_liquidity = data_body[offset:offset+yes_len].decode('utf-8')
            offset += yes_len
            
            # 7. no_liquidity (String)
            no_len = struct.unpack_from('<I', data_body, offset)[0]
            offset += 4
            no_liquidity = data_body[offset:offset+no_len].decode('utf-8')
            offset += no_len
            
            # 8. timestamp (8 bytes, i64)
            timestamp = struct.unpack_from('<q', data_body, offset)[0]
            offset += 8
            
            return {
                "market_pubkey": market_pubkey,
                "market_id": market_id,
                "user": user,
                "is_yes": is_yes,
                "shares": shares,
                "yes_liquidity": yes_liquidity, # Now a string
                "no_liquidity": no_liquidity, # Now a string
                "timestamp": timestamp,
            }
        except Exception as e:
            # Add a print here to see the error
            print(f"!!! FAILED TO PARSE BuySharesEvent: {e} | Log data: {log_data}")
            return None
    # --- END FIX ---

    async def run_event_listener(self):
        """Listens for program logs and indexes BuySharesEvent"""
        print(f"\n Starting event listener for program: {self.program_id}")
        
        while True: # Auto-restart loop
            try:
                async with connect(SOLANA_WS_URL) as websocket:
                    await websocket.logs_subscribe(
                        RpcTransactionLogsFilterMentions(self.program_id),
                        commitment=Confirmed
                    )
                    
                    # The async for loop yields a LIST of messages
                    async for msg_list in websocket: 
                        
                        if not isinstance(msg_list, list) or len(msg_list) == 0:
                            continue
                        
                        # Iterate through the list (usually just one item)
                        for notification in msg_list:
                            
                            # Check if it's the initial subscription confirmation
                            if hasattr(notification, 'result') and isinstance(notification.result, int):
                                subscription_id = notification.result
                                print(f"  Successfully subscribed to logs with ID: {subscription_id}")
                        
                            # Check if it's a log data notification
                            elif hasattr(notification, 'result'): 
                                logs_data = notification.result
                                if not logs_data or not hasattr(logs_data, 'value'):
                                    continue
                                
                                logs = logs_data.value.logs
                                
                                # Flag to see if we found the event
                                found_event = False
                                for log in logs:
                                    # This is the log we are looking for!
                                    if log.startswith("Program data: "):
                                        found_event = True # We found it!
                                        log_data = log.split("Program data: ")[1]
                                        
                                        # Check if it's the BuySharesEvent
                                        if log_data.startswith(EVENT_DISCRIMINATOR_BUY_SHARES):
                                            event_data = self._parse_buy_shares_event(log_data)
                                            if event_data:
                                                # This is the log you want to see
                                                print(f"  EVENT FOUND: User {event_data['user']} bought shares for market {event_data['market_pubkey']}")
                                                
                                                # Save to history collection
                                                self.history_collection.insert_one({
                                                    "market_pubkey": event_data["market_pubkey"],
                                                    "timestamp": event_data["timestamp"],
                                                    "yes_liquidity": event_data["yes_liquidity"],
                                                    "no_liquidity": event_data["no_liquidity"],
                                                })
                                
                                # If we processed all logs and found no event, print a warning.
                                if not found_event:
                                    print(f"  Logs received for tx, but no 'Program data:' event found (RPC node may be stripping events).")

                            else:
                                # Other message type, just log it
                                print(f"  Received unknown websocket message type: {notification}")
                                        
            except Exception as e:
                print(f"Event listener WebSocket error: {e}")
                print("Restarting listener in 10 seconds...")
                await asyncio.sleep(10)

    async def run_resolution_loop(self):
        """Continuously check for markets to resolve/sweep"""
        print(f" Starting resolution loop (checking every {CHECK_INTERVAL_SECONDS}s)...\n")
        
        while True:
            try:
                await self.check_and_resolve_markets()
            except Exception as e:
                print(f" Resolution loop error: {e}")
            
            await asyncio.sleep(CHECK_INTERVAL_SECONDS)

    async def run_market_creation_loop(self):
        """Continuously create new markets on a schedule"""
        print(f" Starting market creation loop (creating every {MARKET_CREATION_INTERVAL_HOURS}h)...\n")
        
        while True:
            try:
                await self.create_new_market()
            except Exception as e:
                print(f" Market creation loop error: {e}")
            
            wait_seconds = MARKET_CREATION_INTERVAL_HOURS * 3600
            print(f" Next market will be created in {MARKET_CREATION_INTERVAL_HOURS} hours...\n")
            await asyncio.sleep(wait_seconds)

    async def run(self):
        """Main bot loop"""
        print(" Prediction Market Bot Starting...\n")
        
        await self.initialize_program()
        
        print(" Creating initial market...")
        await self.create_new_market()
        
        print("\n Starting background loops...")
        resolution_task = asyncio.create_task(self.run_resolution_loop())
        creation_task = asyncio.create_task(self.run_market_creation_loop())
        listener_task = asyncio.create_task(self.run_event_listener())
        
        await asyncio.gather(resolution_task, creation_task, listener_task)

    async def close(self):
        """Cleanup resources"""
        await self.connection.close()
        self.mongo_client.close()


async def main():
    bot = PredictionMarketBot()
    try:
        await bot.run()
    except KeyboardInterrupt:
        print("\n\n Bot shutting down gracefully...")
    finally:
        await bot.close()


if __name__ == "__main__":
    asyncio.run(main())