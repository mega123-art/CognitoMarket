import os
import asyncio
import struct
import base58
from dotenv import load_dotenv
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta
from solders.message import MessageV0
from solders.transaction import VersionedTransaction
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.rpc import types as rpc_types

load_dotenv()

SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com/")
PRIVATE_KEY_BYTES = os.getenv("PRIVATE_KEY_BYTES")
PROGRAM_ID_STR = "CogMUfHjP4A9Lx6M94D6CCjEytxZuaB1uy1AaHQoq3KV"
SYSTEM_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")

CONFIG_SEED = b"config"
FEE_VAULT_SEED = b"fee_vault"

DISCRIMINATORS = {
    "withdraw_fees": bytes([198, 212, 171, 109, 144, 215, 174, 89]),
}

def _load_keypair() -> Keypair:
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

async def _send_and_confirm_tx(connection: AsyncClient, instruction: Instruction, keypair: Keypair) -> str:
    blockhash_resp = await connection.get_latest_blockhash(commitment=Confirmed)
    recent_blockhash = blockhash_resp.value.blockhash

    message = MessageV0.try_compile(
        payer=keypair.pubkey(),
        instructions=[instruction],
        address_lookup_table_accounts=[],
        recent_blockhash=recent_blockhash
    )

    tx = VersionedTransaction(message, [keypair])

    try:
        resp = await connection.send_transaction(
            tx,
            opts=rpc_types.TxOpts(skip_preflight=False, preflight_commitment=Confirmed)
        )
        tx_sig = resp.value

        await connection.confirm_transaction(
            tx_sig,
            commitment=Confirmed,
            last_valid_block_height=blockhash_resp.value.last_valid_block_height,
            sleep_seconds=1
        )
        return str(tx_sig)
    except Exception as e:
        print(f" Transaction failed: {e}")
        raise e

async def withdraw_all_fees():
    print("Connecting to Solana...")
    
    connection = AsyncClient(SOLANA_RPC_URL)
    keypair = _load_keypair()
    authority_pubkey = keypair.pubkey()
    program_id = Pubkey.from_string(PROGRAM_ID_STR)

    print(f"Using Authority: {authority_pubkey}")

    try:
        config_pda, _ = Pubkey.find_program_address([CONFIG_SEED], program_id)
        feeVaultPda, _ = Pubkey.find_program_address([FEE_VAULT_SEED], program_id)
        
        print(f"Fee Vault PDA: {feeVaultPda}")

        balance_resp = await connection.get_balance(feeVaultPda, commitment=Confirmed)
        total_balance_lamports = balance_resp.value
        
        print(f"Total Fee Vault Balance: {total_balance_lamports} lamports")

        
        rent_exempt_lamports = (await connection.get_minimum_balance_for_rent_exemption(0)).value
        
        print(f"Rent-Exempt Minimum: {rent_exempt_lamports} lamports")
        
        amount_to_withdraw = total_balance_lamports - rent_exempt_lamports
        
        if amount_to_withdraw <= 0:
            print("No withdrawable fees found (balance is at or below rent exemption).")
            await connection.close()
            return

        print(f"Attempting to withdraw {amount_to_withdraw} lamports...")

        data = DISCRIMINATORS["withdraw_fees"]
        data += struct.pack('<Q', amount_to_withdraw)

        accounts = [
            AccountMeta(config_pda, is_signer=False, is_writable=False),
            AccountMeta(feeVaultPda, is_signer=False, is_writable=True),
            AccountMeta(authority_pubkey, is_signer=True, is_writable=True),
            AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
        ]

        instruction = Instruction(program_id, data, accounts)

        tx_sig = await _send_and_confirm_tx(connection, instruction, keypair)
        
        print(f"\nSuccessfully withdrew {amount_to_withdraw} lamports.")
        print(f"Transaction signature: {tx_sig}")

    except Exception as e:
        print(f"An error occurred: {e}")
    
    finally:
        await connection.close()
        print("Connection closed.")

if __name__ == "__main__":
    asyncio.run(withdraw_all_fees())