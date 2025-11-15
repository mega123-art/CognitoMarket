
import json
import os
import asyncio
import base58
import base64
import struct
import time
import requests
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List

from dotenv import load_dotenv
from groq import Groq
from pymongo import MongoClient
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.instruction import Instruction, AccountMeta
from solders.message import MessageV0
from solders.transaction import VersionedTransaction
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.rpc import types as rpc_types

load_dotenv()

SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com/")
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
PRIVATE_KEY_BYTES = os.getenv("PRIVATE_KEY_BYTES")
HELIUS_ENDPOINT = os.getenv("HELIUS_ENDPOINT", "https://api-devnet.helius-rpc.com/")
HELIUS_API_KEY = os.getenv("HELIUS_API_KEY")

PROGRAM_ID_STR = "CogMUfHjP4A9Lx6M94D6CCjEytxZuaB1uy1AaHQoq3KV"
SYSTEM_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")

CONFIG_SEED = b"config"
MARKET_SEED = b"market"
VAULT_SEED = b"vault"
USER_POSITION_SEED = b"position"
FEE_VAULT_SEED = b"fee_vault"

INITIAL_LIQUIDITY_SOL = 0.1
MARKET_DURATION_MINUTES = 30
CHECK_INTERVAL_SECONDS = 60
MARKET_CREATION_INTERVAL_MINUTES = 15
POLL_INTERVAL_SECONDS = 10
HELIUS_BATCH_SIZE = 100
DEBUG_MODE = True

DISCRIMINATORS = {
    "initialize": bytes([175, 175, 109, 31, 13, 152, 155, 237]),
    "create_market": bytes([103, 226, 97, 235, 200, 188, 251, 254]),
    "buy_shares": bytes([40, 239, 138, 154, 8, 37, 106, 108]),
    "resolve_market": bytes([155, 23, 80, 173, 46, 74, 23, 239]),
    "claim_winnings": bytes([161, 215, 24, 59, 14, 236, 242, 221]),
    "withdraw_fees": bytes([198, 212, 171, 109, 144, 215, 174, 89]),
}

MARKET_DISCRIMINATOR = bytes([219, 190, 213, 55, 0, 227, 198, 154])
EVENT_DISCRIMINATOR_BUY_SHARES = bytes([185, 52, 1, 127, 117, 180, 40, 122])

class ConfigAccount:
    def __init__(self, authority: Pubkey, market_count: int, fee_percentage: int, bump: int, fee_vault_bump: int):
        self.authority = authority
        self.market_count = market_count
        self.fee_percentage = fee_percentage
        self.bump = bump
        self.fee_vault_bump = fee_vault_bump

class PredictionMarketBot:
    def __init__(self):
        self.connection = AsyncClient(SOLANA_RPC_URL)
        self.keypair = self._load_keypair()
        self.authority_pubkey = self.keypair.pubkey()
        self.groq_client = Groq(api_key=GROQ_API_KEY)
        self.mongo_client = MongoClient(MONGO_URI)
        self.db = self.mongo_client["prediction_market_no"]
        self.markets_collection = self.db["markets"]
        self.history_collection = self.db["market_history"]

        self.markets_collection.create_index("market_id", unique=True)
        self.markets_collection.create_index("resolution_time")
        self.markets_collection.create_index("resolved")
        self.history_collection.create_index("market_pubkey")
        self.history_collection.create_index("timestamp")
        self.history_collection.create_index("tx_signature", unique=True)

        self.program_id = Pubkey.from_string(PROGRAM_ID_STR)
        
        self.last_processed_signature = None

        print(f" Bot initialized with authority: {self.authority_pubkey}")
        print(f"  Program ID: {self.program_id}")
        print(f"  Market duration: {MARKET_DURATION_MINUTES} minutes")
        print(f"  Check interval: {CHECK_INTERVAL_SECONDS} seconds")

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
            raise ValueError(f"Invalid secret key length: {len(secret_key)}")

    def _serialize_string(self, s: str) -> bytes:
        s_bytes = s.encode('utf-8')
        return struct.pack('<I', len(s_bytes)) + s_bytes

    async def _send_and_confirm_tx(self, instruction: Instruction) -> str:
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
            print(f" Transaction failed: {e}")
            raise e

    async def _get_config_account(self) -> Optional[ConfigAccount]:
        config_pda, _ = Pubkey.find_program_address([CONFIG_SEED], self.program_id)
        account_info = await self.connection.get_account_info(config_pda, commitment=Confirmed)

        if not account_info.value:
            return None

        data = account_info.value.data
        expected_len = 8 + 44
        if len(data) < expected_len:
            print(f" Config account data length mismatch. Expected {expected_len}, got {len(data)}")
            return None

        data_body = data[8:]
        try:
            unpacked = struct.unpack('<32sQHB B', data_body[:44])
            return ConfigAccount(
                authority=Pubkey(unpacked[0]),
                market_count=unpacked[1],
                fee_percentage=unpacked[2],
                bump=unpacked[3],
                fee_vault_bump=unpacked[4]
            )
        except struct.error as e:
            print(f" Failed to unpack Config account: {e}")
            return None

    async def read_onchain_market_id(self, market_pubkey: str) -> Optional[int]:
        """Read the actual market_id from on-chain account data."""
        try:
            pubkey = Pubkey.from_string(market_pubkey)
            account_info = await self.connection.get_account_info(pubkey, commitment=Confirmed)
            
            if not account_info.value:
                return None
            
            data = account_info.value.data
            
            if len(data) < 16 or data[:8] != MARKET_DISCRIMINATOR:
                return None
            
            onchain_market_id = struct.unpack('<Q', data[8:16])[0]
            return onchain_market_id
            
        except Exception as e:
            print(f"  Error reading on-chain market_id: {e}")
            return None

    
    def _parse_buy_shares_event_from_helius(self, log_data: str) -> Optional[Dict]:
        """
        Parse BuySharesEvent from base64 encoded log data (Helius format).
        This uses the exact same logic as the standalone parser.
        """
        try:
            data = base64.b64decode(log_data)

            if not data.startswith(EVENT_DISCRIMINATOR_BUY_SHARES):
                return None
                
            data_body = data[8:]

            offset = 0
            
            market_pubkey_bytes = data_body[offset:offset+32]
            market_pubkey = base58.b58encode(market_pubkey_bytes).decode('utf-8')
            offset += 32
            
            market_id = struct.unpack_from('<Q', data_body, offset)[0]
            offset += 8
            
            user_bytes = data_body[offset:offset+32]
            user = base58.b58encode(user_bytes).decode('utf-8')
            offset += 32
            
            is_yes = bool(struct.unpack_from('<B', data_body, offset)[0])
            offset += 1
            
            shares = struct.unpack_from('<Q', data_body, offset)[0]
            offset += 8
            
            yes_liquidity = struct.unpack_from('<Q', data_body, offset)[0]
            offset += 8
            
            no_liquidity = struct.unpack_from('<Q', data_body, offset)[0]
            offset += 8
            
            timestamp_unix = struct.unpack_from('<q', data_body, offset)[0]
            timestamp = datetime.fromtimestamp(timestamp_unix, tz=timezone.utc)

            return {
                "market_pubkey": market_pubkey,
                "market_id": market_id,
                "user": user,
                "is_yes": is_yes,
                "shares": shares,
                "yes_liquidity": str(yes_liquidity),
                "no_liquidity": str(no_liquidity),
                "timestamp": timestamp
            }
        except Exception as e:
            print(f"  Failed to parse Helius log data: {repr(e)}")
            return None

    def _fetch_transactions_from_helius(self, signatures: List[str]) -> List[Dict]:
        """Fetch transaction data from Helius API."""
        if not HELIUS_API_KEY or HELIUS_API_KEY == "YOUR_API_KEY":
            print(" HELIUS_API_KEY not configured, skipping Helius fetch")
            return []
        
        url = f"{HELIUS_ENDPOINT}?api-key={HELIUS_API_KEY}"
        payload = {"transactions": signatures, "parseAll": False}
        
        try:
            response = requests.post(url, json=payload, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            if data:
                print(f"  Helius returned {len(data)} transaction objects")
            else:
                print(f"  Helius returned empty response")
            
            return data
        except requests.exceptions.RequestException as e:
            print(f"  Helius API error: {e}")
            return []

    def _extract_buy_events_from_helius_data(self, tx_data: List[Dict]) -> List[Dict]:
        """Extract BuySharesEvents from Helius transaction data."""
        extracted_events = []

        for tx in tx_data:
            tx_sig = tx.get('signature')
            
            if tx.get('transactionError'):
                continue
            
            log_messages = []
            if 'meta' in tx and 'logMessages' in tx['meta']:
                log_messages = tx['meta']['logMessages']
            elif 'logs' in tx:
                log_messages = tx['logs']
            
            if not log_messages:
                continue
            
            for log in log_messages:
                if isinstance(log, str) and log.startswith("Program data: "):
                    log_data_raw = log.split("Program data: ")[1]
                    log_data = log_data_raw.strip().strip('"')
                    
                    event = self._parse_buy_shares_event_from_helius(log_data)
                    
                    if event:
                        event['tx_signature'] = tx_sig
                        extracted_events.append(event)
                        break

        if not extracted_events and tx_data:
            print(f"  DEBUG: Checked {len(tx_data)} transactions, found 0 BuySharesEvents")
            if tx_data:
                sample_tx = tx_data[0]
                print(f"  Sample tx keys: {list(sample_tx.keys())[:5]}")
                if 'meta' in sample_tx:
                    print(f"  Sample meta keys: {list(sample_tx['meta'].keys())[:5]}")
        
        return extracted_events


    async def scan_and_store_market_pubkeys(self):
        """Scan blockchain for market accounts and sync with database."""
        print("\n Scanning blockchain for market accounts...")
        
        try:
            response = await self.connection.get_program_accounts(
                self.program_id,
                encoding="base64",
                commitment=Confirmed
            )
            
            markets_found = 0
            markets_updated = 0
            markets_added = 0
            markets_corrupted = 0
            
            for account_info in response.value:
                try:
                    pubkey = str(account_info.pubkey)
                    data = account_info.account.data
                    
                    if len(data) < 16:
                        continue
                    
                    if data[:8] != MARKET_DISCRIMINATOR:
                        continue
                    
                    onchain_market_id = struct.unpack('<Q', data[8:16])[0]
                    markets_found += 1
                    
                    doc = self.markets_collection.find_one({"market_id": onchain_market_id})
                    
                    if doc:
                        stored_pubkey = doc.get("market_pubkey")
                        if not stored_pubkey or stored_pubkey != pubkey:
                            self.markets_collection.update_one(
                                {"market_id": onchain_market_id},
                                {"$set": {"market_pubkey": pubkey}}
                            )
                            markets_updated += 1
                        continue
                    
                    try:
                        offset = 16
                        offset += 32
                        
                        question_len = struct.unpack_from('<I', data, offset)[0]
                        offset += 4
                        question = data[offset:offset+question_len].decode('utf-8')
                        offset += question_len
                        
                        desc_len = struct.unpack_from('<I', data, offset)[0]
                        offset += 4
                        description = data[offset:offset+desc_len].decode('utf-8')
                        offset += desc_len
                        
                        cat_len = struct.unpack_from('<I', data, offset)[0]
                        offset += 4
                        category = data[offset:offset+cat_len].decode('utf-8')
                        offset += cat_len
                        
                        offset += 8 + 8 + 8 + 8 + 8 + 16 + 8
                        
                        resolved = bool(struct.unpack_from('<B', data, offset)[0])
                        offset += 1
                        
                        outcome = None
                        has_outcome = bool(struct.unpack_from('<B', data, offset)[0])
                        offset += 1
                        if has_outcome:
                            outcome = bool(struct.unpack_from('<B', data, offset)[0])
                        
                        document = {
                            "market_id": onchain_market_id,
                            "market_pubkey": pubkey,
                            "question": question,
                            "description": description,
                            "category": category,
                            "resolution_time": 0,
                            "created_at": datetime.now(timezone.utc),
                            "resolved": resolved,
                            "outcome": outcome,
                            "resolution_reasoning": "Imported from blockchain" if resolved else None,
                            "resolved_at": datetime.now(timezone.utc) if resolved else None,
                            "swept": False
                        }
                        
                        self.markets_collection.insert_one(document)
                        markets_added += 1
                        print(f"  Added Market #{onchain_market_id}: {question[:50]}...")
                        
                    except Exception as parse_e:
                        print(f"  Could not parse market {pubkey}, marking as corrupted: {parse_e}")
                        document = {
                            "market_id": onchain_market_id,
                            "market_pubkey": pubkey,
                            "question": f"[Corrupted Market #{onchain_market_id}]",
                            "description": "Market from old program version - cannot be parsed",
                            "category": "Unknown",
                            "resolution_time": 0,
                            "created_at": datetime.now(timezone.utc),
                            "resolved": True,
                            "outcome": None,
                            "resolution_reasoning": "Market corrupted",
                            "resolved_at": datetime.now(timezone.utc),
                            "swept": True
                        }
                        
                        self.markets_collection.insert_one(document)
                        markets_added += 1
                        markets_corrupted += 1
                
                except Exception as e:
                    print(f"  Error reading account {account_info.pubkey}: {e}")
                    continue
            
            print(f" Scan complete! Found {markets_found} markets")
            if markets_added > 0:
                print(f"  - Added {markets_added} new markets to database")
                if markets_corrupted > 0:
                    print(f"  - {markets_corrupted} corrupted markets (marked as resolved)")
            if markets_updated > 0:
                print(f"  - Updated {markets_updated} pubkeys")
            print()
            
        except Exception as e:
            print(f" Error during market scan: {e}\n")

    async def initialize_program(self):
        print(" Checking program initialization...")
        config_pda, _ = Pubkey.find_program_address([CONFIG_SEED], self.program_id)
        feeVaultPda, _ = Pubkey.find_program_address([FEE_VAULT_SEED], self.program_id)

        config_account = await self._get_config_account()
        if config_account:
            print(f" Program already initialized\n")
            return

        print(" Initializing program...")
        try:
            data = DISCRIMINATORS["initialize"]

            accounts = [
                AccountMeta(config_pda, is_signer=False, is_writable=True),
                AccountMeta(feeVaultPda, is_signer=False, is_writable=True),
                AccountMeta(self.authority_pubkey, is_signer=True, is_writable=True),
                AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
            ]

            instruction = Instruction(self.program_id, data, accounts)
            tx_sig = await self._send_and_confirm_tx(instruction)
            print(f" Program initialized: {tx_sig}\n")

        except Exception as e:
            print(f" Initialization error: {e}\n")

    def is_similar_question(self, new_question: str, existing_question: str) -> bool:
        """Check if two questions are too similar."""
        new_norm = new_question.lower().strip().replace("?", "").replace("!", "")
        existing_norm = existing_question.lower().strip().replace("?", "").replace("!", "")
        
        if new_norm == existing_norm:
            return True
        
        if new_norm in existing_norm or existing_norm in new_norm:
            return True
        
        new_words = set(new_norm.split())
        existing_words = set(existing_norm.split())
        
        if len(new_words) == 0 or len(existing_words) == 0:
            return False
        
        overlap = len(new_words.intersection(existing_words))
        similarity = overlap / max(len(new_words), len(existing_words))
        
        return similarity >= 0.7

    def check_duplicate_question(self, question: str) -> bool:
        """Check if a similar question already exists in active markets."""
        active_markets = self.markets_collection.find({
            "resolved": False,
            "question": {"$ne": None}
        })
        
        for market in active_markets:
            if self.is_similar_question(question, market["question"]):
                return True
        
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24)
        recent_markets = self.markets_collection.find({
            "resolved": True,
            "resolved_at": {"$gte": cutoff_time},
            "question": {"$ne": None}
        })
        
        for market in recent_markets:
            if self.is_similar_question(question, market["question"]):
                return True
        
        return False

    def generate_market_idea(self) -> Optional[Dict]:
        """Generate a unique prediction market question."""
        max_attempts = 5
        
        for attempt in range(max_attempts):
            try:
                recent_markets = list(self.markets_collection.find(
                    {"created_at": {"$gte": datetime.now(timezone.utc) - timedelta(days=7)}},
                    {"question": 1}
                ).limit(20))
                
                recent_topics = [m["question"] for m in recent_markets if m.get("question")]
                
                avoid_instruction = ""
                if recent_topics:
                    topics_str = "\n".join([f"- {q}" for q in recent_topics[:10]])
                    avoid_instruction = f"\n\nAVOID these recent topics:\n{topics_str}\n"
                
                prompt = f"""Generate a unique prediction market question that hasn't been asked recently.

{avoid_instruction}
Return ONLY JSON:
{{
    "question": "Clear yes/no question under 200 characters",
    "description": "Resolution criteria under 1000 characters",
    "category": "Technology, Finance, Sports, Politics, or Entertainment"
}}"""

                response = self.groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.8 + (attempt * 0.1),
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
                
                if self.check_duplicate_question(market_data["question"]):
                    print(f"  Duplicate detected (attempt {attempt + 1}/{max_attempts}), regenerating...")
                    continue
                
                return market_data

            except Exception as e:
                print(f"  Market generation error (attempt {attempt + 1}/{max_attempts}): {e}")
                if attempt < max_attempts - 1:
                    continue
        
        print(f"  Failed to generate unique market after {max_attempts} attempts")
        return None

    async def create_market_onchain(self, market_data: Dict) -> Optional[Dict]:
        try:
            config_pda, _ = Pubkey.find_program_address([CONFIG_SEED], self.program_id)
            config_account = await self._get_config_account()
            if not config_account:
                raise ValueError("Config account not found")

            market_id = config_account.market_count
            resolution_time = int((datetime.now(timezone.utc) + timedelta(minutes=MARKET_DURATION_MINUTES)).timestamp())
            initial_liquidity = int(INITIAL_LIQUIDITY_SOL * 1_000_000_000)

            market_id_bytes = market_id.to_bytes(8, "little")
            market_pda, _ = Pubkey.find_program_address([MARKET_SEED, market_id_bytes], self.program_id)
            vault_pda, _ = Pubkey.find_program_address([VAULT_SEED, market_id_bytes], self.program_id)

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

            print(f" Market #{market_id} created: {tx_sig}")
            return {"market_id": market_id, "market_pubkey": str(market_pda), "resolution_time": resolution_time}

        except Exception as e:
            print(f" Market creation error: {e}")
            return None

    async def store_market_in_db(self, market_id: int, market_data: Dict, resolution_time: int, market_pubkey: str):
        try:
            document = {
                "market_id": market_id,
                "market_pubkey": market_pubkey,
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

            self.markets_collection.update_one(
                {"market_id": market_id},
                {"$set": document},
                upsert=True
            )

        except Exception as e:
            print(f" Database error: {e}")

    async def create_new_market(self):
        print("\n Generating new market...")

        market_data = self.generate_market_idea()
        if not market_data:
            return

        print(f" {market_data['question']}")

        created = await self.create_market_onchain(market_data)
        if not created:
            return

        await self.store_market_in_db(
            created["market_id"], 
            market_data, 
            created["resolution_time"],
            created["market_pubkey"]
        )

    def resolve_market_with_ai(self, market_data: Dict) -> Optional[Dict]:
        try:
            prompt = f"""Resolve this prediction market.

QUESTION: {market_data['question']}
DESCRIPTION: {market_data['description']}

Return ONLY JSON:
{{
    "outcome": true or false,
    "reasoning": "Brief explanation under 500 chars",
    "confidence": 0.0 to 1.0
}}"""

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

            return json.loads(content)

        except Exception as e:
            print(f" AI resolution error: {e}")
            return None

    async def resolve_market_onchain(self, market_id: int, outcome_yes: bool) -> bool:
        """Calls the resolve_market instruction."""
        try:
            doc = self.markets_collection.find_one({"market_id": market_id})
            if not doc:
                print(f"  Market #{market_id} not in database")
                return False
            
            market_pubkey_str = doc.get("market_pubkey")
            if not market_pubkey_str:
                print(f"  Market #{market_id} has no pubkey")
                return False

            onchain_market_id = await self.read_onchain_market_id(market_pubkey_str)
            if onchain_market_id is None:
                print(f"  Failed to read on-chain data")
                return False
            
            if onchain_market_id != market_id:
                print(f"  Market ID mismatch: DB={market_id}, On-chain={onchain_market_id}")
                print(f"  Updating database...")
                self.markets_collection.update_one(
                    {"market_pubkey": market_pubkey_str},
                    {"$set": {"market_id": onchain_market_id}}
                )
                market_id = onchain_market_id
            
            market_pda = Pubkey.from_string(market_pubkey_str)
            config_pda, _ = Pubkey.find_program_address([CONFIG_SEED], self.program_id)

            data = DISCRIMINATORS["resolve_market"]
            data += struct.pack('<B', outcome_yes)

            accounts = [
                AccountMeta(config_pda, is_signer=False, is_writable=False),
                AccountMeta(market_pda, is_signer=False, is_writable=True),
                AccountMeta(self.authority_pubkey, is_signer=True, is_writable=True),
            ]

            instruction = Instruction(self.program_id, data, accounts)
            tx_sig = await self._send_and_confirm_tx(instruction)

            print(f" Market #{market_id} resolved: {tx_sig}")
            return True

        except Exception as e:
            print(f" Resolution error: {e}")
            return False

    async def verify_market_pda(self, market_id: int, market_pubkey: str) -> bool:
        """Verify if a market's PDA matches what the current program expects."""
        try:
            expected_pda, _ = Pubkey.find_program_address(
                [MARKET_SEED, market_id.to_bytes(8, "little")],
                self.program_id
            )
            return str(expected_pda) == market_pubkey
        except:
            return False

    async def check_and_resolve_markets(self):
        current_time = datetime.now(timezone.utc)
        current_timestamp = int(current_time.timestamp())

        markets_to_resolve = self.markets_collection.find({
            "resolved": False,
            "resolution_time": {"$lte": current_timestamp}
        })

        for market in markets_to_resolve:
            market_id = market['market_id']
            market_pubkey = market.get('market_pubkey')
            
            if not market_pubkey:
                print(f"\n  Skipping Market #{market_id} (no pubkey stored)")
                continue
            
            is_valid = await self.verify_market_pda(market_id, market_pubkey)
            if not is_valid:
                print(f"\n  Skipping Market #{market_id} (corrupted PDA from old program)")
                print(f"     This market was created before program redeployment")
                self.markets_collection.update_one(
                    {"market_id": market_id},
                    {
                        "$set": {
                            "resolved": True,
                            "outcome": None,
                            "resolution_reasoning": "Market corrupted - created with old program version",
                            "resolved_at": datetime.now(timezone.utc)
                        }
                    }
                )
                continue
            
            print(f"\n Resolving Market #{market_id}")
            print(f"  {market['question']}")

            resolution = self.resolve_market_with_ai(market)
            if not resolution:
                continue

            outcome_yes = resolution["outcome"]
            print(f"  Outcome: {'YES' if outcome_yes else 'NO'}")

            success = await self.resolve_market_onchain(market_id, outcome_yes)

            if success:
                self.markets_collection.update_one(
                    {"market_id": market_id},
                    {
                        "$set": {
                            "resolved": True,
                            "outcome": outcome_yes,
                            "resolution_reasoning": resolution["reasoning"],
                            "resolved_at": datetime.now(timezone.utc)
                        }
                    }
                )

    async def poll_for_transactions_with_helius(self):
        """
        Poll for new transactions and use Helius parser to extract BuySharesEvents.
        This replaces the old RPC-based polling method.
        """
        print(f"\n Starting Helius-powered transaction polling loop...")
        
        if not HELIUS_API_KEY or HELIUS_API_KEY == "YOUR_API_KEY":
            print(" WARNING: HELIUS_API_KEY not configured. Falling back to RPC-only mode.")
            print(" This may hit rate limits. Please configure Helius for production use.\n")
            use_helius = False
        else:
            use_helius = True
            print(f" Helius API configured\n")
        
        while True:
            try:
                until_sig = None
                if self.last_processed_signature:
                    until_sig = Signature.from_string(self.last_processed_signature)
                
                response = await self.connection.get_signatures_for_address(
                    self.program_id,
                    until=until_sig,
                    limit=HELIUS_BATCH_SIZE,
                    commitment=Confirmed
                )
                
                signatures = response.value
                if not signatures:
                    await asyncio.sleep(POLL_INTERVAL_SECONDS)
                    continue

                print(f"\n Found {len(signatures)} new transaction(s)...")
                
                
                sig_strings = [str(sig.signature) for sig in signatures]
                
                if use_helius:
                    print(f" Fetching transaction details from Helius...")
                    tx_data = self._fetch_transactions_from_helius(sig_strings)
                    
                    if not tx_data:
                        print(f"  No data returned from Helius, falling back to RPC")
                        use_helius = False
                    else:
                        buy_events = self._extract_buy_events_from_helius_data(tx_data)
                        
                        if buy_events:
                            print(f" Extracted {len(buy_events)} BuySharesEvent(s)")
                            
                            for event in buy_events:
                                try:
                                    existing = self.history_collection.find_one({
                                        "tx_signature": event["tx_signature"]
                                    })
                                    
                                    if not existing:
                                        self.history_collection.insert_one({
                                            "market_pubkey": event["market_pubkey"],
                                            "market_id": event["market_id"],
                                            "user": event["user"],
                                            "is_yes": event["is_yes"],
                                            "shares": event["shares"],
                                            "yes_liquidity": event["yes_liquidity"],
                                            "no_liquidity": event["no_liquidity"],
                                            "timestamp": event["timestamp"],
                                            "tx_signature": event["tx_signature"]
                                        })
                                        
                                        print(f"  Stored: Market #{event['market_id']} - {'YES' if event['is_yes'] else 'NO'} - {event['shares']} shares")
                                except Exception as e:
                                    print(f"  Failed to store event: {e}")
                        else:
                            print(f"  No BuySharesEvents found in this batch")
                        
                        self.last_processed_signature = sig_strings[0]
                        await asyncio.sleep(POLL_INTERVAL_SECONDS)
                        continue
                
                if not use_helius:
                    print(f"  Processing with RPC fallback...")
                    
                    for sig_info in signatures:
                        await asyncio.sleep(0.25)
                        
                        try:
                            tx_sig = sig_info.signature
                            
                            tx_response = await self.connection.get_transaction(
                                tx_sig,
                                max_supported_transaction_version=0,
                                commitment=Confirmed
                            )
                            
                            tx = tx_response.value
                            if not tx or not tx.transaction or not tx.transaction.meta:
                                continue
                                
                            if tx.transaction.meta.err is not None:
                                continue
                                
                            log_messages = tx.transaction.meta.log_messages
                            if not log_messages:
                                continue
                                
                            for log in log_messages:
                                if log.startswith("Program data: "):
                                    log_data_raw = log.split("Program data: ")[1]
                                    log_data = log_data_raw.strip().strip('"')
                                    
                                    event = self._parse_buy_shares_event_from_helius(log_data)
                                    
                                    if event:
                                        print(f"  Event: Market #{event['market_id']} - {'YES' if event['is_yes'] else 'NO'} trade")
                                        
                                        try:
                                            existing = self.history_collection.find_one({
                                                "tx_signature": str(tx_sig)
                                            })
                                            
                                            if not existing:
                                                self.history_collection.insert_one({
                                                    "market_pubkey": event["market_pubkey"],
                                                    "market_id": event["market_id"],
                                                    "user": event["user"],
                                                    "is_yes": event["is_yes"],
                                                    "shares": event["shares"],
                                                    "yes_liquidity": event["yes_liquidity"],
                                                    "no_liquidity": event["no_liquidity"],
                                                    "timestamp": event["timestamp"],
                                                    "tx_signature": str(tx_sig)
                                                })
                                                print(f"  Stored event")
                                        except Exception as e:
                                            print(f"  Failed to store: {e}")
                                        
                                        break
                            
                        except Exception as e:
                            print(f"  Failed to process tx {sig_info.signature}: {e.args}")
                            continue
                    
                    if signatures:
                        self.last_processed_signature = str(signatures[0].signature)
                
            except Exception as e:
                print(f" Error in polling loop: {repr(e)}")
                print(" Reconnecting in 10 seconds...")
                await asyncio.sleep(10)
                continue
            
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

    async def run_resolution_loop(self):
                print(f" Resolution loop active\n")
                while True:
                    try:
                        await self.check_and_resolve_markets()
                    except Exception as e:
                        print(f" Resolution loop error: {e}")
                    await asyncio.sleep(CHECK_INTERVAL_SECONDS)        

    async def run_market_creation_loop(self):
        print(f" Market creation loop active\n")
        while True:
            try:
                await self.create_new_market()
            except Exception as e:
                print(f" Creation error: {e}")
            await asyncio.sleep(MARKET_CREATION_INTERVAL_MINUTES * 60)

    async def run(self):
        print(" Prediction Market Bot Starting\n")
        await self.initialize_program()
        await self.scan_and_store_market_pubkeys()

        try:
            response = await self.connection.get_signatures_for_address(
                self.program_id, 
                limit=1, 
                commitment=Confirmed
            )
            if response.value:
                self.last_processed_signature = str(response.value[0].signature)
                print(f" Starting poll from signature: {self.last_processed_signature}\n")
            else:
                print(" No previous transactions found. Polling for new ones.\n")
        except Exception as e:
            print(f" Error getting last signature: {e}. Polling from scratch.")

        print(" Creating 3 initial markets...")
        for i in range(3):
            await self.create_new_market()
            await asyncio.sleep(1)

        print("\n Starting background loops...\n")
        await asyncio.gather(
            self.run_resolution_loop(),
            self.run_market_creation_loop(),
            self.poll_for_transactions_with_helius()
        )

    async def close(self):
        await self.connection.close()
        self.mongo_client.close()

async def main():
    bot = PredictionMarketBot()
    try:
        await bot.run()
    except KeyboardInterrupt:
        print("\n\n Bot shutting down...")
    finally:
        await bot.close()

if __name__ == "__main__":
    asyncio.run(main())