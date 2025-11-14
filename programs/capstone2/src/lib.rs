use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("CogMJfnjfbzfZ1oYterCgGB6yQGro6rLf164VbzZEDsw");

const MARKET_SEED: &[u8] = b"market";
const VAULT_SEED: &[u8] = b"vault";
const USER_POSITION_SEED: &[u8] = b"position";
const FEE_VAULT_SEED: &[u8] = b"fee_vault";
const PRECISION: u128 = 1_000_000_000; // 9 decimal precision for AMM calculations

#[program]
pub mod prediction_market {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.market_count = 0;
        config.fee_percentage = 200;
        config.bump = ctx.bumps.config;
        config.fee_vault_bump = ctx.bumps.fee_vault;

        // Initialize fee vault by transferring rent-exempt minimum
        let rent = Rent::get()?;
        let min_rent = rent.minimum_balance(0);
        
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.fee_vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, min_rent)?;

        msg!("Prediction market initialized with authority: {}", config.authority);
        msg!("Fee vault initialized at: {}", ctx.accounts.fee_vault.key());
        Ok(())
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        question: String,
        description: String,
        category: String,
        resolution_time: i64,
        initial_liquidity_lamports: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.authority,
            ErrorCode::Unauthorized
        );

        require!(question.len() <= 200, ErrorCode::QuestionTooLong);
        require!(description.len() <= 1000, ErrorCode::DescriptionTooLong);
        require!(category.len() <= 50, ErrorCode::CategoryTooLong);
        require!(
            resolution_time > Clock::get()?.unix_timestamp,
            ErrorCode::InvalidResolutionTime
        );
        require!(
            initial_liquidity_lamports >= 10_000_000,
            ErrorCode::InsufficientInitialLiquidity
        );

        let market = &mut ctx.accounts.market;
        market.market_id = market_id;
        market.authority = ctx.accounts.config.authority;
        market.question = question;
        market.description = description;
        market.category = category;
        market.resolution_time = resolution_time;
        market.created_at = Clock::get()?.unix_timestamp;
        market.initial_liquidity = initial_liquidity_lamports;
        market.yes_liquidity = initial_liquidity_lamports;
        market.no_liquidity = initial_liquidity_lamports;
        
        // High-precision k constant
        market.k_constant = (initial_liquidity_lamports as u128)
            .checked_mul(PRECISION)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_mul(initial_liquidity_lamports as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_mul(PRECISION)
            .ok_or(ErrorCode::MathOverflow)?;
            
        market.total_volume = 0;
        market.resolved = false;
        market.outcome = None;
        market.total_yes_shares = 0;
        market.total_no_shares = 0;
        market.bump = ctx.bumps.market;
        market.vault_bump = ctx.bumps.vault;

        // Transfer initial liquidity to vault PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, initial_liquidity_lamports * 2)?;

        let config = &mut ctx.accounts.config;
        config.market_count += 1;

        msg!("Market #{} created: {}", market_id, market.question);
        Ok(())
    }

    pub fn buy_shares(
        ctx: Context<BuyShares>,
        is_yes: bool,
        amount_lamports: u64,
        min_shares_out: u64,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(!market.resolved, ErrorCode::MarketResolved);
        require!(
            Clock::get()?.unix_timestamp < market.resolution_time,
            ErrorCode::MarketExpired
        );
        require!(amount_lamports > 0, ErrorCode::InvalidAmount);

        let fee = amount_lamports
            .checked_mul(ctx.accounts.config.fee_percentage as u64)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;

        let amount_after_fee = amount_lamports
            .checked_sub(fee)
            .ok_or(ErrorCode::MathOverflow)?;

        // High-precision AMM calculation
        let (shares_out, new_yes_liquidity, new_no_liquidity) = if is_yes {
            let new_yes_with_precision = (market.yes_liquidity as u128)
                .checked_mul(PRECISION)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_add((amount_after_fee as u128).checked_mul(PRECISION).ok_or(ErrorCode::MathOverflow)?)
                .ok_or(ErrorCode::MathOverflow)?;

            let new_no_with_precision = market.k_constant
                .checked_div(new_yes_with_precision)
                .ok_or(ErrorCode::MathOverflow)?;

            let new_yes = (new_yes_with_precision / PRECISION) as u64;
            let new_no = (new_no_with_precision / PRECISION) as u64;

            let old_no_with_precision = (market.no_liquidity as u128)
                .checked_mul(PRECISION)
                .ok_or(ErrorCode::MathOverflow)?;

            let shares_with_precision = old_no_with_precision
                .checked_sub(new_no_with_precision)
                .ok_or(ErrorCode::InsufficientLiquidity)?;

            let shares = (shares_with_precision / PRECISION) as u64;

            (shares, new_yes, new_no)
        } else {
            let new_no_with_precision = (market.no_liquidity as u128)
                .checked_mul(PRECISION)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_add((amount_after_fee as u128).checked_mul(PRECISION).ok_or(ErrorCode::MathOverflow)?)
                .ok_or(ErrorCode::MathOverflow)?;

            let new_yes_with_precision = market.k_constant
                .checked_div(new_no_with_precision)
                .ok_or(ErrorCode::MathOverflow)?;

            let new_yes = (new_yes_with_precision / PRECISION) as u64;
            let new_no = (new_no_with_precision / PRECISION) as u64;

            let old_yes_with_precision = (market.yes_liquidity as u128)
                .checked_mul(PRECISION)
                .ok_or(ErrorCode::MathOverflow)?;

            let shares_with_precision = old_yes_with_precision
                .checked_sub(new_yes_with_precision)
                .ok_or(ErrorCode::InsufficientLiquidity)?;

            let shares = (shares_with_precision / PRECISION) as u64;

            (shares, new_yes, new_no)
        };

        require!(shares_out >= min_shares_out, ErrorCode::SlippageExceeded);

        // Send fees to protocol fee vault
        let fee_cpi = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.fee_vault.to_account_info(),
            },
        );
        system_program::transfer(fee_cpi, fee)?;

        // Transfer net amount to market vault
        let net_cpi = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        system_program::transfer(net_cpi, amount_after_fee)?;

        market.yes_liquidity = new_yes_liquidity;
        market.no_liquidity = new_no_liquidity;
        market.total_volume += amount_lamports;

        let position = &mut ctx.accounts.user_position;
        if position.user == Pubkey::default() {
            position.user = ctx.accounts.user.key();
            position.market_id = market.market_id;
            position.yes_shares = if is_yes { shares_out } else { 0 };
            position.no_shares = if !is_yes { shares_out } else { 0 };
            position.claimed = false;
            position.bump = ctx.bumps.user_position;
        } else {
            if is_yes {
                position.yes_shares = position.yes_shares
                    .checked_add(shares_out)
                    .ok_or(ErrorCode::MathOverflow)?;
            } else {
                position.no_shares = position.no_shares
                    .checked_add(shares_out)
                    .ok_or(ErrorCode::MathOverflow)?;
            }
        }

        if is_yes {
            market.total_yes_shares = market.total_yes_shares
                .checked_add(shares_out as u128)
                .ok_or(ErrorCode::MathOverflow)?;
        } else {
            market.total_no_shares = market.total_no_shares
                .checked_add(shares_out as u128)
                .ok_or(ErrorCode::MathOverflow)?;
        }

        emit!(BuySharesEvent {
            market_pubkey: market.key(),
            market_id: market.market_id,
            user: ctx.accounts.user.key(),
            is_yes,
            shares: shares_out,
            yes_liquidity: market.yes_liquidity,
            no_liquidity: market.no_liquidity,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "User {} bought {} {} shares for {} lamports (fee: {})",
            ctx.accounts.user.key(),
            shares_out,
            if is_yes { "YES" } else { "NO" },
            amount_lamports,
            fee
        );

        Ok(())
    }

    pub fn resolve_market(
        ctx: Context<ResolveMarket>,
        outcome_yes: bool,
    ) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.authority,
            ErrorCode::Unauthorized
        );

        let market = &mut ctx.accounts.market;

        require!(!market.resolved, ErrorCode::MarketResolved);
        require!(
            Clock::get()?.unix_timestamp >= market.resolution_time,
            ErrorCode::MarketNotExpired
        );

        market.resolved = true;
        market.outcome = Some(outcome_yes);

        msg!(
            "Market #{} resolved: {} - Outcome: {}",
            market.market_id,
            market.question,
            if outcome_yes { "YES" } else { "NO" }
        );

        Ok(())
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let position = &mut ctx.accounts.user_position;

        require!(
            position.user == ctx.accounts.user.key(),
            ErrorCode::Unauthorized
        );

        require!(market.resolved, ErrorCode::MarketNotResolved);
        require!(!position.claimed, ErrorCode::AlreadyClaimed);

        let outcome_yes = market.outcome.ok_or(ErrorCode::MarketNotResolved)?;

        let winning_shares = if outcome_yes {
            position.yes_shares
        } else {
            position.no_shares
        };

        require!(winning_shares > 0, ErrorCode::NoWinningShares);

        let total_winning_shares_u128 = if outcome_yes {
            market.total_yes_shares
        } else {
            market.total_no_shares
        };

        require!(total_winning_shares_u128 > 0, ErrorCode::NoWinningShares);

        let vault_balance = ctx.accounts.vault.lamports();

        let payout = (winning_shares as u128)
            .checked_mul(vault_balance as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(total_winning_shares_u128)
            .ok_or(ErrorCode::MathOverflow)?;

        let payout = payout as u64;

        require!(payout > 0, ErrorCode::NoWinningShares);

        let market_id_bytes = market.market_id.to_le_bytes();

        let seeds = &[
            VAULT_SEED,
            market_id_bytes.as_ref(),
            &[market.vault_bump],
        ];
        let signer = &[&seeds[..]];

        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            ctx.accounts.vault.key,
            ctx.accounts.user.key,
            payout,
        );

        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.user.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;

        if outcome_yes {
            market.total_yes_shares = market.total_yes_shares
                .checked_sub(winning_shares as u128)
                .ok_or(ErrorCode::MathOverflow)?;
        } else {
            market.total_no_shares = market.total_no_shares
                .checked_sub(winning_shares as u128)
                .ok_or(ErrorCode::MathOverflow)?;
        }

        position.yes_shares = 0;
        position.no_shares = 0;
        position.claimed = true;

        msg!("User {} claimed {} lamports", ctx.accounts.user.key(), payout);

        Ok(())
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.authority,
            ErrorCode::Unauthorized
        );

        let fee_vault_balance = ctx.accounts.fee_vault.lamports();
        require!(amount <= fee_vault_balance, ErrorCode::InsufficientFunds);

        let seeds = &[
            FEE_VAULT_SEED,
            &[ctx.accounts.config.fee_vault_bump],
        ];
        let signer = &[&seeds[..]];

        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            ctx.accounts.fee_vault.key,
            ctx.accounts.authority.key,
            amount,
        );

        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.fee_vault.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;

        msg!("Authority withdrew {} lamports in fees", amount);

        Ok(())
    }

    pub fn sweep_funds(ctx: Context<SweepFunds>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.authority,
            ErrorCode::Unauthorized
        );

        let market = &ctx.accounts.market;

        require!(market.resolved, ErrorCode::MarketNotResolved);

        let vault_balance = ctx.accounts.vault.lamports();
        
        require!(vault_balance > 0, ErrorCode::NoRemainingFunds);

        let market_id_bytes = market.market_id.to_le_bytes();

        let seeds = &[
            VAULT_SEED,
            market_id_bytes.as_ref(),
            &[market.vault_bump],
        ];
        let signer = &[&seeds[..]];

        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            ctx.accounts.vault.key,
            ctx.accounts.authority.key,
            vault_balance,
        );

        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;

        msg!(
            "Authority swept {} lamports from market #{}", 
            vault_balance, 
            market.market_id
        );

        Ok(())
    }
}

// CORRECT FIX: Use UncheckedAccount and manually initialize in the function
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::LEN,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    /// CHECK: Fee vault PDA - manually initialized in initialize() function
    #[account(
        mut,
        seeds = [FEE_VAULT_SEED],
        bump
    )]
    pub fee_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = authority,
        space = 8 + Market::LEN,
        seeds = [MARKET_SEED, market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,

    /// CHECK: Vault PDA - will be funded with initial liquidity
    #[account(
        mut,
        seeds = [VAULT_SEED, market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyShares<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    /// CHECK: Vault PDA validated by seeds
    #[account(
        mut,
        seeds = [VAULT_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: Fee vault PDA validated by seeds - initialized in initialize()
    #[account(
        mut,
        seeds = [FEE_VAULT_SEED],
        bump = config.fee_vault_bump
    )]
    pub fee_vault: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserPosition::LEN,
        seeds = [
            USER_POSITION_SEED,
            user.key().as_ref(),
            market.market_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED, user_position.market_id.to_le_bytes().as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    /// CHECK: Vault PDA validated by seeds
    #[account(
        mut,
        seeds = [VAULT_SEED, user_position.market_id.to_le_bytes().as_ref()],
        bump = market.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            USER_POSITION_SEED,
            user.key().as_ref(),
            user_position.market_id.to_le_bytes().as_ref()
        ],
        bump = user_position.bump
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// CHECK: Fee vault PDA validated by seeds
    #[account(
        mut,
        seeds = [FEE_VAULT_SEED],
        bump = config.fee_vault_bump
    )]
    pub fee_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SweepFunds<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    /// CHECK: Vault PDA validated by seeds
    #[account(
        mut,
        seeds = [VAULT_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub market_count: u64,
    pub fee_percentage: u16,
    pub bump: u8,
    pub fee_vault_bump: u8,
}

impl Config {
    pub const LEN: usize = 32 + 8 + 2 + 1 + 1;
}

#[account]
pub struct Market {
    pub market_id: u64,
    pub authority: Pubkey,
    pub question: String,
    pub description: String,
    pub category: String,
    pub resolution_time: i64,
    pub created_at: i64,
    pub initial_liquidity: u64,
    pub yes_liquidity: u64,
    pub no_liquidity: u64,
    pub k_constant: u128,
    pub total_volume: u64,
    pub resolved: bool,
    pub outcome: Option<bool>,
    pub total_yes_shares: u128,
    pub total_no_shares: u128,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Market {
    pub const LEN: usize = 8 + 32 + (4 + 200) + (4 + 1000) + (4 + 50)
        + 8 + 8 + 8 + 8 + 16 + 8 + 1 + (1 + 1)
        + 16 + 16
        + 1 + 1;
}

#[account]
pub struct UserPosition {
    pub user: Pubkey,
    pub market_id: u64,
    pub yes_shares: u64,
    pub no_shares: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl UserPosition {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 1 + 1;
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Question too long")]
    QuestionTooLong,
    #[msg("Description too long")]
    DescriptionTooLong,
    #[msg("Category too long")]
    CategoryTooLong,
    #[msg("Invalid resolution time")]
    InvalidResolutionTime,
    #[msg("Insufficient initial liquidity")]
    InsufficientInitialLiquidity,
    #[msg("Market already resolved")]
    MarketResolved,
    #[msg("Market expired")]
    MarketExpired,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("Slippage exceeded")]
    SlippageExceeded,
    #[msg("Market not expired yet")]
    MarketNotExpired,
    #[msg("Market not resolved")]
    MarketNotResolved,
    #[msg("No winning shares")]
    NoWinningShares,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("No remaining funds")]
    NoRemainingFunds,
    #[msg("Insufficient funds")]
    InsufficientFunds,
}

#[event]
pub struct BuySharesEvent {
    pub market_pubkey: Pubkey,
    pub market_id: u64,
    pub user: Pubkey,
    pub is_yes: bool,
    pub shares: u64,
    pub yes_liquidity: u64,
    pub no_liquidity: u64,
    pub timestamp: i64,
}