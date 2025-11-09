#!/usr/bin/env python3
"""
prediction_market_bot_final_working.py

FINAL FIX: The issue is that Anchor needs the market_id as an instruction parameter
to validate PDA seeds. We must pass market_id explicitly to resolve_market.
"""

import json
import os
import asyncio
import base58
import base64
import struct
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict

from dotenv import load_dotenv
from groq import Groq
from pymongo import MongoClient
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta
from solders.message import MessageV0
from solders.transaction import VersionedTransaction
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
PRIVATE_KEY_BYTES = os.getenv("PRIVATE_KEY_BYTES")
PROGRAM_ID_STR = "AiCMVwVQAfKmgaLov17UJw6eo4DSCh1FiaEN226ftXa2"
SYSTEM_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")

# Market parameters
INITIAL_LIQUIDITY_SOL = 0.1
MARKET_DURATION_MINUTES = 30
CHECK_INTERVAL_SECONDS = 60
MARKET_CREATION_INTERVAL_MINUTES = 15
SWEEP_GRACE_PERIOD_MINUTES = 10

# Anchor Instruction Discriminators
DISCRIMINATORS = {
    "initialize": bytes([175, 175, 109, 31, 13, 152, 155, 237]),
    "create_market": bytes([103, 226, 97, 235, 200, 188, 251, 254]),
    "resolve_market": bytes([155, 23, 80, 173, 46, 74, 23, 239]),
    "sweep_funds": bytes([150, 235, 156, 105, 133, 142, 200, 162]),
}

MARKET_DISCRIMINATOR = bytes([219, 190, 213, 55, 0, 227, 198, 154])
EVENT_DISCRIMINATOR_BUY_SHARES = "S+S9q8iA99U="

class ConfigAccount:
    def __init__(self, authority: Pubkey, market_count: int, fee_percentage: int, bump: int):
        self.authority = authority
        self.market_count = market_count
        self.fee_percentage = fee_percentage
        self.bump = bump

class PredictionMarketBot:
    def __init__(self):
        self.connection = AsyncClient(SOLANA_RPC_URL)
        self.keypair = self._load_keypair()
        self.authority_pubkey = self.keypair.pubkey()
        self.groq_client = Groq(api_key=GROQ_API_KEY)
        self.mongo_client = MongoClient(MONGO_URI)
        self.db = self.mongo_client["cognitomarket"]
        self.markets_collection = self.db["markets"]
        self.history_collection = self.db["market_history"]

        self.markets_collection.create_index("market_id", unique=True)
        self.markets_collection.create_index("resolution_time")
        self.markets_collection.create_index("resolved")
        self.history_collection.create_index("market_pubkey")
        self.history_collection.create_index("timestamp")

        self.program_id = Pubkey.from_string(PROGRAM_ID_STR)

        print(f" Bot initialized with authority: {self.authority_pubkey}")
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
            print(f"Transaction failed: {e}")
            raise e

    async def _get_config_account(self) -> Optional[ConfigAccount]:
        config_pda, _ = Pubkey.find_program_address([b"config"], self.program_id)
        account_info = await self.connection.get_account_info(config_pda, commitment=Confirmed)

        if not account_info.value:
            return None

        data = account_info.value.data
        expected_len = 8 + 32 + 8 + 2 + 1
        if len(data) < expected_len:
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
                    
                except Exception as e:
                    continue
            
            print(f" Scan complete! Found {markets_found} markets")
            if markets_updated > 0:
                print(f"  - Updated {markets_updated} pubkeys")
            print()
            
        except Exception as e:
            print(f" Error during market scan: {e}\n")

    async def initialize_program(self):
        print("Checking program initialization...")
        config_pda, _ = Pubkey.find_program_address([b"config"], self.program_id)

        config_account = await self._get_config_account()
        if config_account:
            print(f" Program already initialized\n")
            return

        print("Initializing program...")
        try:
            data = DISCRIMINATORS["initialize"]

            accounts = [
                AccountMeta(config_pda, is_signer=False, is_writable=True),
                AccountMeta(self.authority_pubkey, is_signer=True, is_writable=True),
                AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
            ]

            instruction = Instruction(self.program_id, data, accounts)
            tx_sig = await self._send_and_confirm_tx(instruction)
            print(f" Program initialized: {tx_sig}\n")

        except Exception as e:
            print(f" Initialization error: {e}\n")

    def generate_market_idea(self) -> Optional[Dict]:
        try:
            prompt = """Generate a prediction market question.

Return ONLY JSON:
{
    "question": "Clear yes/no question under 200 characters",
    "description": "Resolution criteria under 1000 characters",
    "category": "Technology, Finance, Sports, Politics, or Entertainment"
}"""

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

    async def create_market_onchain(self, market_data: Dict) -> Optional[Dict]:
        try:
            config_pda, _ = Pubkey.find_program_address([b"config"], self.program_id)
            config_account = await self._get_config_account()
            if not config_account:
                raise ValueError("Config account not found")

            market_id = config_account.market_count
            resolution_time = int((datetime.now(timezone.utc) + timedelta(minutes=MARKET_DURATION_MINUTES)).timestamp())
            initial_liquidity = int(INITIAL_LIQUIDITY_SOL * 1_000_000_000)

            market_id_bytes = market_id.to_bytes(8, "little")
            market_pda, _ = Pubkey.find_program_address([b"market", market_id_bytes], self.program_id)
            vault_pda, _ = Pubkey.find_program_address([b"vault", market_id_bytes], self.program_id)

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
        """
        CRITICAL FIX: Pass market_id as instruction parameter for Anchor PDA validation.
        """
        try:
            doc = self.markets_collection.find_one({"market_id": market_id})
            if not doc:
                print(f"  Market #{market_id} not in database")
                return False
            
            market_pubkey_str = doc.get("market_pubkey")
            if not market_pubkey_str:
                print(f"  Market #{market_id} has no pubkey")
                return False

            # Verify on-chain market_id matches
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
            config_pda, _ = Pubkey.find_program_address([b"config"], self.program_id)

            # CRITICAL FIX: Include market_id as instruction data parameter
            data = DISCRIMINATORS["resolve_market"]
            data += struct.pack('<Q', market_id)  # <-- This is the fix!
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

    async def sweep_funds_onchain(self, market_id: int) -> bool:
        try:
            doc = self.markets_collection.find_one({"market_id": market_id})
            if not doc or not doc.get("market_pubkey"):
                return False

            market_pubkey_str = doc.get("market_pubkey")
            onchain_market_id = await self.read_onchain_market_id(market_pubkey_str)
            if onchain_market_id is None:
                return False
            
            market_pda = Pubkey.from_string(market_pubkey_str)
            config_pda, _ = Pubkey.find_program_address([b"config"], self.program_id)
            vault_pda, _ = Pubkey.find_program_address(
                [b"vault", onchain_market_id.to_bytes(8, "little")], 
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

            print(f" Swept Market #{market_id}: {tx_sig}")
            return True

        except Exception as e:
            if "No remaining funds" in str(e) or "6016" in str(e):
                return True
            print(f" Sweep error: {e}")
            return False

    def _parse_buy_shares_event(self, log_data: str):
        try:
            data = base64.b64decode(log_data)
            data_body = data[8:]

            offset = 0
            market_pubkey = str(Pubkey(data_body[offset:offset+32]))
            offset += 32
            market_id = struct.unpack_from('<Q', data_body, offset)[0]
            offset += 8
            user = str(Pubkey(data_body[offset:offset+32]))
            offset += 32
            is_yes = bool(struct.unpack_from('<B', data_body, offset)[0])
            offset += 1
            shares = struct.unpack_from('<Q', data_body, offset)[0]
            offset += 8
            yes_liquidity = struct.unpack_from('<Q', data_body, offset)[0]
            offset += 8
            no_liquidity = struct.unpack_from('<Q', data_body, offset)[0]

            return {
                "market_pubkey": market_pubkey,
                "market_id": market_id,
                "user": user,
                "is_yes": is_yes,
                "shares": shares,
                "yes_liquidity": str(yes_liquidity),
                "no_liquidity": str(no_liquidity),
            }
        except:
            return None

    async def run_event_listener(self):
        print(f"\n Starting event listener...")

        while True:
            try:
                async with connect(SOLANA_WS_URL) as websocket:
                    await websocket.logs_subscribe(
                        RpcTransactionLogsFilterMentions(self.program_id),
                        commitment=Confirmed
                    )

                    first_resp = await websocket.recv()
                    if not first_resp:
                        raise Exception("No websocket response")

                    print(f"  Connected to event stream\n")

                    while True:
                        try:
                            msgs = await websocket.recv()
                            for msg in msgs:
                                if not msg or not hasattr(msg, 'result'):
                                    continue

                                logs = msg.result.value.logs
                                if not logs:
                                    continue

                                for log in logs:
                                    if log.startswith("Program data: "):
                                        log_data = log.split("Program data: ")[1]
                                        if log_data.startswith(EVENT_DISCRIMINATOR_BUY_SHARES):
                                            event = self._parse_buy_shares_event(log_data)
                                            if event:
                                                print(f"  Trade: Market #{event['market_id']} - {'YES' if event['is_yes'] else 'NO'}")
                                                self.history_collection.insert_one({
                                                    "market_pubkey": event["market_pubkey"],
                                                    "timestamp": datetime.now(timezone.utc),
                                                    "yes_liquidity": event["yes_liquidity"],
                                                    "no_liquidity": event["no_liquidity"],
                                                })

                        except Exception as e:
                            print(f"  Event error: {e}")

            except Exception as e:
                print(f" WebSocket error: {e}")
                print("Reconnecting in 10 seconds...")
                await asyncio.sleep(10)

    async def verify_market_pda(self, market_id: int, market_pubkey: str) -> bool:
        """
        Verify if a market's PDA matches what the current program expects.
        Returns True if valid, False if corrupted (from old program version).
        """
        try:
            # Derive what the PDA SHOULD be
            expected_pda, _ = Pubkey.find_program_address(
                [b"market", market_id.to_bytes(8, "little")],
                self.program_id
            )
            
            # Compare with stored pubkey
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
            
            # Verify PDA is valid for current program version
            is_valid = await self.verify_market_pda(market_id, market_pubkey)
            if not is_valid:
                print(f"\n  Skipping Market #{market_id} (corrupted PDA from old program)")
                print(f"     This market was created before program redeployment")
                # Mark as resolved to prevent retrying
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

        # Sweep funds
        sweep_cutoff = current_time - timedelta(minutes=SWEEP_GRACE_PERIOD_MINUTES)
        markets_to_sweep = self.markets_collection.find({
            "resolved": True,
            "swept": False,
            "resolved_at": {"$lte": sweep_cutoff}
        })

        for market in markets_to_sweep:
            print(f"\n Sweeping Market #{market['market_id']}")
            success = await self.sweep_funds_onchain(market["market_id"])
            if success:
                self.markets_collection.update_one(
                    {"market_id": market["market_id"]},
                    {"$set": {"swept": True}}
                )

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

        print(" Creating 3 initial markets...")
        for i in range(3):
            await self.create_new_market()

        print("\n Starting background loops...\n")
        await asyncio.gather(
            self.run_resolution_loop(),
            self.run_market_creation_loop(),
            self.run_event_listener()
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