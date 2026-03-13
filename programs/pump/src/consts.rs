/// Initial price: lamports per one token (without decimals)
pub const INITIAL_PRICE: u64 = 600;

/// Graduation threshold: 89 SOL in lamports
pub const GRADUATION_THRESHOLD_LAMPORTS: u64 = 89_000_000_000;

/// Deploy fee: 1.5 SOL in lamports
pub const DEPLOY_FEE_LAMPORTS: u64 = 1_500_000_000;

/// Fee split basis points (out of 10000)
/// Total swap fee is 1.5% (150 bps), split as:
///   0.60% LP auto-compound  = 4000 / 10000 of the fee
///   0.50% airdrop pool      = 3333 / 10000 of the fee
///   0.40% protocol          = 2667 / 10000 of the fee
pub const LP_FEE_BPS: u64 = 4000;
pub const AIRDROP_FEE_BPS: u64 = 3333;
pub const PROTOCOL_FEE_BPS: u64 = 2667;

/// Deploy fee split (out of 100)
pub const DEPLOY_LP_PCT: u64 = 50;
pub const DEPLOY_PROTOCOL_PCT: u64 = 30;
pub const DEPLOY_AIRDROP_PCT: u64 = 10;
pub const DEPLOY_INFRA_PCT: u64 = 10;

/// Max wallet anti-snipe windows (seconds from launch)
pub const SNIPE_WINDOW_1: i64 = 120;   // 0-2min: 1.5% max (150 bps)
pub const SNIPE_WINDOW_2: i64 = 300;   // 2-5min: 2.5% max (250 bps)
pub const SNIPE_WINDOW_3: i64 = 600;   // 5-10min: 5% max (500 bps)

/// Anti-vamp: MC threshold for protection activation (in USD cents to avoid floats)
/// $100,000 = 10_000_000 cents. Keeper checks this off-chain and calls activate_protection.
pub const MC_PROTECTION_THRESHOLD_CENTS: u64 = 10_000_000;

/// Identity lock cooldown: 24 hours in seconds
pub const IDENTITY_COOLDOWN_SECS: i64 = 86_400;

/// Anti-vamp source lock: backend signature TTL in seconds
/// Must match SIGNATURE_TTL_SEC in antivamp-server.js (120s)
pub const SIGNATURE_TTL_SECS: i64 = 120;