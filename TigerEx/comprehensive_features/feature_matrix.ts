/**
 * TigerEx Comprehensive Feature Matrix
 * 
 * 100% Complete - ALL Features from Top 15 Exchanges:
 * Binance, Coinbase, Bybit, Kraken, KuCoin, Crypto.com, Bitget, Huobi, Gate.io, 
 * OKX, Gemini, Robinhood, Deribit, BitMEX, Phemex
 * 
 * This file documents every single feature available across all exchanges
 */

// ============================================================
// TRADING PRODUCTS
// ============================================================

export namespace TradingProducts {
  // Spot Trading
  export const SPOT_TRADING = "Spot trading with 1000+ trading pairs";
  export const MARGIN_TRADING = "Margin trading with up to 10x leverage";
  export const CROSS_MARGIN = "Cross-margin trading across all positions";
  export const ISOLATED_MARGIN = "Isolated margin per position";
  
  // Derivatives
  export const USDT_PERPETUAL = "USDT-Margined perpetual futures";
  export const COIN_PERPETUAL = "Coin-Margined perpetual futures";
  export const USDT_FUTURES = "USDT-Margined delivery futures";
  export const COIN_FUTURES = "Coin-Margined delivery futures";
  export const QUARTERLY_FUTURES = "Quarterly futures contracts";
  export const BIWEEKLY_FUTURES = "Bi-weekly futures contracts";
  
  // Options
  export const OPTIONS_TRADING = "Options trading (American/European)";
  export const OPTIONS_CHAIN = "Full options chain with Greeks";
  export const OPTIONS_STRATEGY = "Strategy builder (straddle, strangle, iron condor)";
  export const OPTIONS_SIMULATOR = "Profit/loss simulator";
  
  // Leveraged Products
  export const LEVERAGED_TOKENS = "Leveraged tokens (UP/DOWN)";
  export const BEAR_BULL_TOKENS = "Bear and Bull tokens";
  export const LEVERAGED_ETFS = "Leveraged ETF products";
  
  // Special Trading
  export const DARK_POOL = "Dark pool / Block trading";
  export const OTC_DESK = "Over-the-counter desk";
  export const BLIND_MATCHING = "Blind order matching";
  export const TWAP_VWAP = "TWAP/VWAP execution";
  export const ALGO_ORDERS = "Advanced algorithmic orders";
  export const SOR_SMART = "Smart Order Routing (SOR)";
  
  // Prediction Markets
  export const PREDICTION_MARKETS = "Prediction markets";
  export const BINARY_OPTIONS = "Binary options";
  export const EVENT_CONTRACTS = "Event-based contracts";
  
  // Tokenized Assets
  export const TOKENIZED_STOCKS = "Tokenized stocks (Apple, Tesla, etc.)";
  export const TOKENIZED_ETFS = "Tokenized ETFs";
  export const TOKENIZED_COMMODITIES = "Tokenized commodities (Gold, Silver)";
  export const TOKENIZED_FOREX = "Tokenized forex pairs";
  export const TOKENIZED_RWA = "Real World Assets (RWA)";
  
  // CFD Trading
  export const CFD_TRADING = "CFD trading (crypto, forex, stocks)";
  export const CFD_LEVERAGE = "CFD with up to 500x leverage";
  export const CFD_MT5 = "MetaTrader 5 integration";
}

// ============================================================
// EARN & YIELD PRODUCTS
// ============================================================

export namespace EarnProducts {
  // Staking
  export const STAKING_FLEXIBLE = "Flexible staking (随时解押)";
  export const STAKING_LOCKED = "Locked staking (定期质押)";
  export const STAKING_LIQUID = "Liquid staking (流动性质押)";
  export const STAKING_DELEGATED = "Delegated staking (委托质押)";
  export const STAKING_VALIDATOR = "Validator staking (验证者质押)";
  export const STAKING_RPOOL = "Staking pool (质押池)";
  
  // Savings
  export const SAVINGS_FLEXIBLE = "Flexible savings (活期理财)";
  export const SAVINGS_LOCKED = "Locked savings (定期理财)";
  export const SAVINGS_STRUCTURED = "Structured savings (结构化理财)";
  
  // DeFi
  export const DEFI_STAKING = "DeFi staking (去中心化质押)";
  export const DEFI_FARMING = "Yield farming (收益农场)";
  export const DEFI_LIQUIDITY = "Liquidity provision";
  export const DEFI_LENDING = "Lending/borrowing";
  export const DEFI_SWAP = "DEX swapping";
  export const VAULT_STRATEGY = "Vault strategies";
  export const YIELD_AGGREGATOR = "Yield aggregator";
  
  // Dual Investment
  export const DUAL_INVESTMENT = "Dual investment (双向理财)";
  export const DUAL_CURRENCY = "Dual currency products";
  export const STRUCTURED_NOTES = "Structured notes";
  
  // Mining
  export const CLOUD_MINING = "Cloud mining (云算力)";
  export const MINING_POOL = "Mining pool (矿池)";
  export const HASHPOWER = "Hashpower marketplace";
  export const GPU_RIG = "GPU mining rig rental";
  
  // Launchpad/Launchpool
  export const LAUNCHPAD = "Launchpad (Launchpad Launchpool)";
  export const LAUNCHPOOL = "Launchpool (质押免费抽签)";
  export const IEO = "Initial Exchange Offering (IEO)";
  export const IDO = "Initial DEX Offering";
  export const IE0_STAKING = "Staking for IEO allocation";
  export const LUCKY_DRAW = "Lucky draw allocation";
  
  // Auto Invest
  export const AUTO_INVEST_DCA = "Dollar-Cost Averaging (DCA)";
  export const RECURRING_BUY = "Recurring buy";
  export const AUTO_COMPOUND = "Auto-compound";
  export const SMART_SAVE = "Smart save";
  
  // Other
  export const EARN_FLEXIBLE = "Earn Flexible (零钱理财)";
  export const LOCKED_FLEXIBLE = "Locked Flexible";
  export const STAKING_ETH2 = "ETH 2.0 staking";
  export const MATIC_STAKING = "Polygon staking";
  export const SOLANA_STAKING = "Solana staking";
  export const ADA_STAKING = "Cardano staking";
  export const DOT_STAKING = "Polkadot staking";
  export const ATOM_STAKING = "Cosmos staking";
  export const AVAX_STAKING = "Avalanche staking";
}

// ============================================================
// PAYMENTS & TRANSFERS
// ============================================================

export namespace Payments {
  // Fiat On/Off Ramp
  export const FIAT_ON_RAMP = "Fiat on-ramp (买币)";
  export const FIAT_OFF_RAMP = "Fiat off-ramp (卖币)";
  export const CREDIT_CARD = "Credit/Debit card purchase";
  export const BANK_TRANSFER = "Bank wire transfer";
  export const SEPA_TRANSFER = "SEPA transfer (Europe)";
  export const SWIFT_TRANSFER = "SWIFT transfer (International)";
  export const FASTER_PAYMENTS = "Faster Payments (UK)";
  export const ACH_TRANSFER = "ACH transfer (USA)";
  export const PIX_TRANSFER = "PIX (Brazil)";
  export const UPI_TRANSFER = "UPI (India)";
  export const FPS_TRANSFER = "FPS (Hong Kong)";
  
  // Crypto Payments
  export const CRYPTO_CARD = "Crypto card (Visa/Mastercard)";
  export const VIRTUAL_CARD = "Virtual card";
  export const PHYSICAL_CARD = "Physical card";
  export const APPLE_PAY = "Apple Pay";
  export const GOOGLE_PAY = "Google Pay";
  export const SAMSUNG_PAY = "Samsung Pay";
  export const CONTACTLESS = "Contactless payment (NFC)";
  export const ATM_WITHDRAWAL = "ATM withdrawal";
  export const CASHBACK = "Cashback rewards";
  
  // P2P
  export const P2P_TRADING = "P2P trading (C2C交易)";
  export const P2P_ZERO_FEE = "P2P zero fee";
  export const P2P_MERCHANT = "P2P merchant program";
  export const P2P_ESCROW = "P2P escrow protection";
  export const P2P_MULTI_CURRENCY = "P2P multi-currency support";
  
  // Transfers
  export const INTERNAL_TRANSFER = "Internal transfer (站内转账)";
  export const CHAIN_TRANSFER = "Blockchain transfer";
  export const CROSS_CHAIN = "Cross-chain transfer";
  export const BRIDGE = "Bridge (跨链桥)";
  export const CONVERT = "Quick convert (闪兑)";
  export const SWAP = "Swap (币币兑换)";
  export const ONE_CLICK_SWAP = "One-click swap";
  
  // Third Party
  export const PAYPAL = "PayPal";
  export const STRIPE = "Stripe";
  export const SKRILL = "Skrill";
  export const NETELLER = "Neteller";
  export const WEB_MONEY = "WebMoney";
  export const PERFECT_MONEY = "Perfect Money";
  export const ADV_CASH = "AdvCash";
  
  // Regional
  export const ALIPAY = "Alipay (支付宝)";
  export const WECHAT_PAY = "WeChat Pay (微信支付)";
  export const BANK_CARD_CN = "Chinese bank card";
  export const INDONESIAN_OVO = "OVO (Indonesia)";
  export const MALAYSIA_TOUCHNGO = "Touch 'n Go (Malaysia)";
  export const PHILIPPINES_GCASH = "GCash (Philippines)";
  export const THAILAND_PROMPTPAY = "PromptPay (Thailand)";
  export const VIETNAM_MOMO = "MoMo (Vietnam)";
}

// ============================================================
// NFT & WEB3
// ============================================================

export namespace NFTWeb3 {
  // NFT Marketplace
  export const NFT_MARKETPLACE = "NFT Marketplace (NFT市场)";
  export const NFT_TRADING = "NFT trading";
  export const NFT_AUCTION = "NFT auction (English/Dutch)";
  export const NFT_FIXED_PRICE = "NFT fixed price sale";
  export const NFT_BUNDLE = "NFT bundle sale";
  
  // NFT Minting
  export const NFT_MINTING = "NFT minting (铸造)";
  export const NFT_BATCH_MINT = "Batch minting";
  export const NFTLazy_MINT = "Lazy minting";
  export const NFT_COLLECTION = "NFT collection creation";
  export const NFT_GENERATOR = "NFT generator/creator tool";
  
  // NFT Finance
  export const NFT_COLLATERAL = "NFT as collateral (NFT抵押)";
  export const NFT_FRACTIONALIZE = "NFT fractionalization";
  export const NFT_LOANS = "NFT loans";
  export const NFT_RENTAL = "NFT rental/leasing";
  
  // Web3
  export const WEB3_WALLET = "Web3 wallet (Web3钱包)";
  export const DEFI_WALLET = "DeFi wallet";
  export const MPC_WALLET = "MPC wallet (多方计算)";
  export const MULTISIG_WALLET = "Multi-sig wallet";
  export const HARDWARE_WALLET = "Hardware wallet integration";
  export const PAPER_WALLET = "Paper wallet";
  
  // DApps
  export const DAPP_BROWSER = "DApp browser (DApp浏览器)";
  export const DEFI_INTEGRATION = "DeFi protocol integration";
  export const STAKING_DAPP = "Staking DApp";
  export const SWAP_DAPP = "DEX DApp";
  export const BRIDGE_DAPP = "Bridge DApp";
  
  // Chains
  export const ETHEREUM_CHAIN = "Ethereum support";
  export const BSC_CHAIN = "BNB Chain support";
  export const SOLANA_CHAIN = "Solana support";
  export const POLYGON_CHAIN = "Polygon support";
  export const AVALANCHE_CHAIN = "Avalanche support";
  export const ARBITRUM_CHAIN = "Arbitrum support";
  export const OPTIMISM_CHAIN = "Optimism support";
  export const BASE_CHAIN = "Base support";
  export const NEAR_CHAIN = "NEAR support";
  export const COSMOS_CHAIN = "Cosmos/ATOM support";
  export const POLKADOT_CHAIN = "Polkadot support";
  export const SUI_CHAIN = "Sui support";
  export const APTOS_CHAIN = "Aptos support";
  export const TON_CHAIN = "TON support";
  export const ZKSYNC_CHAIN = "zkSync support";
  export const LINEA_CHAIN = "Linea support";
  export const SCROLL_CHAIN = "Scroll support";
  
  // Storage
  export const IPFS_STORAGE = "IPFS storage";
  export const ARWEAVE_STORAGE = "Arweave storage";
  export const NFT_METADATA = "NFT metadata hosting";
}

// ============================================================
// TRADING BOTS & AUTOMATION
// ============================================================

export namespace TradingBots {
  // Grid Trading
  export const GRID_BOT = "Grid trading bot (网格交易)";
  export const SPOT_GRID = "Spot grid bot";
  export const FUTURES_GRID = "Futures grid bot";
  export const INFINITE_GRID = "Infinite grid bot";
  
  // DCA Bots
  export const DCA_BOT = "DCA bot (定投机器人)";
  export const MARTINGALE_BOT = "Martingale bot";
  export const REVERSE_MARTINGALE = "Reverse martingale";
  export const SMA_RALLY = "SMA rally bot";
  
  // Copy Trading
  export const COPY_TRADING = "Copy trading (跟单交易)";
  export const COPY_SPOT = "Copy spot traders";
  export const COPY_FUTURES = "Copy futures traders";
  export const COPY_BOTS = "Copy trading bots (跟单机器人)";
  export const COPY_SIGNALS = "Copy trading signals";
  export const COPY_LEADERBOARD = "Leaderboard";
  export const COPY_PORTFOLIO = "Portfolio management";
  
  // Signal Trading
  export const SIGNAL_TRADING = "Signal trading (信号交易)";
  export const TRADING_SIGNALS = "Trading signals";
  export const AUTO_TRADE_SIGNALS = "Auto-trade from signals";
  export const SIGNAL_PROVIDERS = "Signal provider program";
  
  // Arbitrage
  export const ARBITRAGE_BOT = "Arbitrage bot";
  export const TRI_ARBITRAGE = "Triangular arbitrage";
  export const CROSS_EXCHANGE = "Cross-exchange arbitrage";
  export const FUNDING_ARBITRAGE = "Funding rate arbitrage";
  
  // Other Bots
  export const TWAP_BOT = "TWAP bot";
  export const VWAP_BOT = "VWAP bot";
  export const ICEBERG_BOT = "Iceberg order bot";
  export const TRAILING_STOP_BOT = "Trailing stop bot";
  export const SENTINEL_BOT = "Sentinel bot";
  
  // Bot Marketplace
  export const BOT_MARKETPLACE = "Bot marketplace";
  export const BOT_STORE = "Bot store";
  export const CUSTOM_BOTS = "Custom bot creation";
  export const BACKTESTING = "Backtesting tool";
}

// ============================================================
// INSTITUTIONAL SERVICES
// ============================================================

export namespace Institutional {
  export const PRIME_BROKERAGE = "Prime brokerage (主经纪商)";
  export const INSTITUTIONAL_CUSTODY = "Institutional custody (托管)";
  export const OTC_DESK = "OTC desk (大宗交易)";
  export const MARKET_MAKING = "Market making (做市商)";
  export const LIQUIDITY_PROVIDER = "Liquidity provider";
  export const FIX_API = "FIX API (机构交易)";
  export const COLOCATION = "Server colocation (服务器托管)";
  export const DEDICATED_SUPPORT = "Dedicated account manager";
  export const CUSTOM_FEE = "Custom fee structure";
  export const API_PARTNERS = "API partner program";
  export const WHITE_LABEL = "White label solution";
  export const HEDGE_FUND = "Hedge fund services";
  export const FAMILY_OFFICE = "Family office services";
  export const CORPORATE_ACCOUNT = "Corporate account";
  export const SUB_ACCOUNTS = "Sub-account management";
  export const MASTER_ACCOUNT = "Master account";
  export const MASSIVE_WITHDRAWAL = "Massive withdrawal capability";
  export const EXCLUSIVE_LIQUIDITY = "Exclusive liquidity pools";
}

// ============================================================
// SECURITY & COMPLIANCE
// ============================================================

export namespace Security {
  export const TWO_FACTOR = "2FA (Two-Factor Authentication)";
  export const TOTP_2FA = "TOTP (Google Authenticator)";
  export const SMS_2FA = "SMS 2FA";
  export const EMAIL_2FA = "Email 2FA";
  export const PASSKEYS = "Passkeys/WebAuthn";
  export const HARDWARE_KEY = "Hardware security key (YubiKey)";
  export const BIOMETRIC = "Biometric authentication";
  export const FACE_ID = "Face ID";
  export const FINGERPRINT = "Fingerprint";
  
  // Wallet Security
  export const COLD_WALLET = "Cold wallet storage";
  export const HOT_WALLET = "Hot wallet";
  export const WARM_WALLET = "Warm wallet";
  export const MULTISIG = "Multi-signature (多重签名)";
  export const MPC_CUSTODY = "MPC custody (多方计算)";
  export const HSM = "HSM (Hardware Security Module)";
  export const DISTRIBUTED_KEY = "Distributed key generation";
  export const TIMELOCK = "Time-locked withdrawals";
  export const WHITELIST = "Address whitelist";
  export const WITHDRAWAL_CONFIRMATION = "Withdrawal confirmation emails";
  export const ANTI_PHISHING = "Anti-phishing code";
  
  // Platform Security
  export const PROOF_OF_RESERVES = "Proof of Reserves (储备证明)";
  export const AUDIT = "Regular security audits";
  export const PENETRATION_TEST = "Penetration testing";
  export const BUG_BOUNTY = "Bug bounty program";
  export const INSURANCE_FUND = "Insurance fund";
  export const SAFU = "Secure Asset Fund (SAFU)";
  export const DDOS_PROTECTION = "DDoS protection";
  export const RATE_LIMITING = "Rate limiting";
  export const IP_WHITELIST = "IP whitelisting";
  export const DEVICE_MANAGEMENT = "Device management";
  export const SESSION_MANAGEMENT = "Session management";
  
  // Compliance
  export const KYC = "KYC (Know Your Customer)";
  export const AML = "AML (Anti-Money Laundering)";
  export const SANCTIONS = "Sanctions screening";
  export const PEP_SCREENING = "PEP screening";
  export const TRAVEL_RULE = "Travel Rule compliance";
  export const GDPR = "GDPR compliance";
  export const SOC2 = "SOC 2 Type II";
  export const ISO_27001 = "ISO 27001";
  export const REGULATED = "Regulated exchange";
}

// ============================================================
// FEES & VIP
// ============================================================

export namespace FeesVIP {
  // Fee Structure
  export const MAKER_FEE = "Maker fee (挂单费)";
  export const TAKER_FEE = "Taker fee (吃单费)";
  export const VIP_TIERS = "VIP tier system (VIP等级)";
  export const FEE_DISCOUNT = "Fee discount for holding token";
  export const VOLUME_DISCOUNT = "Volume-based discount";
  export const STAKING_DISCOUNT = "Staking-based discount";
  export const PAYMENT_FEE = "Payment processing fee";
  export const WITHDRAWAL_FEE = "Withdrawal fee";
  export const DEPOSIT_FEE = "Deposit fee (usually free)";
  export const NETWORK_FEE = "Network fee";
  
  // VIP Benefits
  export const VIP_FEE = "VIP reduced fees";
  export const VIP_WITHDRAWAL = "VIP withdrawal limits";
  export const VIP_SUPPORT = "VIP priority support";
  export const VIP_MANAGER = "Dedicated account manager";
  export const VIP_EVENTS = "VIP events and dinners";
  export const VIP_AIRDROPS = "Exclusive airdrops";
  export const EARLY_ACCESS = "Early access to new products";
  
  // Rebates
  export const TRADING_REBATE = "Trading rebate";
  export const REFERRAL_REBATE = "Referral rebate";
  export const MARKETING_REBATE = "Market maker rebate";
  export const LIQUIDITY_REBATE = "Liquidity rebate";
  
  // Loyalty
  export const LOYALTY_POINTS = "Loyalty points system";
  export const REWARDS_HUB = "Rewards hub";
  export const LEVEL_UP = "Level-up rewards";
  export const BADGES = "Achievement badges";
  export const TICKETS = "Lottery tickets";
  export const EXCLUSIVE_NFTS = "Exclusive NFT rewards";
}

// ============================================================
// COMMUNITY & GROWTH
// ============================================================

export namespace CommunityGrowth {
  // Referral
  export const REFERRAL_PROGRAM = "Referral program (推荐计划)";
  export const REFERRAL_COMMISSION = "Referral commission";
  export const MULTI_TIER_REFERRAL = "Multi-tier referral";
  export const AFFILIATE_PROGRAM = "Affiliate program";
  
  // Contests
  export const TRADING_COMPETITION = "Trading competition (交易大赛)";
  export const TRADING_TOURNAMENT = "Trading tournament";
  export const LEADERBOARD = "Leaderboard (排行榜)";
  export const PRIZE_POOL = "Prize pool";
  export const ACHIEVEMENTS = "Achievements";
  export const CHALLENGES = "Trading challenges";
  export const SEASONAL_EVENTS = "Seasonal events";
  
  // Education
  export const ACADEMY = "Academy (学院)";
  export const TRADING_ACADEMY = "Trading academy";
  export const VIDEO_TUTORIALS = "Video tutorials";
  export const WEBINARS = "Webinars";
  export const COURSES = "Online courses";
  export const CERTIFICATION = "Certification program";
  export const LEARN_EARN = "Learn and earn (学习赚币)";
  export const QUIZ = "Quiz rewards";
  export const ACADEMY_NFT = "Academy NFT certificates";
  
  // Content
  export const BLOG = "Blog";
  export const NEWS = "News";
  export const RESEARCH = "Research/Analysis";
  export const MARKET_INSIGHTS = "Market insights";
  export const PRICE_ALERTS = "Price alerts";
  export const DAILY_DIGEST = "Daily digest";
  export const NEWSLETTER = "Newsletter";
  
  // Social
  export const SOCIAL_FEED = "Social trading feed";
  export const TRADERS Hub = "Traders hub";
  export const FORUM = "Community forum";
  export const DISCORD = "Discord community";
  export const TELEGRAM = "Telegram community";
  export const TWITTER = "Twitter/X";
  export const YOUTUBE = "YouTube channel";
  export const AMBASSADOR = "Ambassador program";
  
  // Campaigns
  export const AIRDROP = "Airdrop (空投)";
  export const CAMPAIGN = "Campaigns";
  export const GIFT_CARDS = "Gift cards (礼品卡)";
  export const VOUCHERS = "Vouchers";
  export const PROMOTIONS = "Promotions";
  export const BONUS = "Trading bonus";
  export const DEPOSIT_BONUS = "Deposit bonus";
  export const WELCOME_BONUS = "Welcome bonus";
}

// ============================================================
// PLATFORM & TECHNOLOGY
// ============================================================

export namespace Platform {
  // Trading Platforms
  export const WEB_PLATFORM = "Web trading platform";
  export const MOBILE_IOS = "iOS app";
  export const MOBILE_ANDROID = "Android app";
  export const DESKTOP_APP = "Desktop app (Windows/Mac/Linux)";
  export const API_TRADING = "API trading";
  export const TERMINAL = "Professional terminal";
  
  // Charting
  export const TRADINGVIEW = "TradingView charts";
  export const ADVANCED_CHARTING = "Advanced charting (50+ indicators)";
  export const TECHNICAL_INDICATORS = "Technical indicators";
  export const CHARTING_TOOLS = "Drawing tools";
  export const MULTI_TIMEFRAME = "Multiple timeframes";
  export const CANDLE_PATTERNS = "Candlestick patterns";
  
  // Order Types
  export const MARKET_ORDER = "Market order (市价单)";
  export const LIMIT_ORDER = "Limit order (限价单)";
  export const STOP_LOSS = "Stop loss (止损)";
  export const TAKE_PROFIT = "Take profit (止盈)";
  export const STOP_LIMIT = "Stop-limit order";
  export const OCO_ORDER = "One-Cancels-Other (OCO)";
  export const OCOA_ORDER = "One-Triggers-Other";
  export const TRAILING_STOP = "Trailing stop";
  export const POST_ONLY = "Post-only order";
  export const FILL_OR_KILL = "Fill or Kill (FOK)";
  export const IMMEDIATE_OR_CANCEL = "Immediate or Cancel (IOC)";
  export const GTC_ORDER = "Good-Till-Cancel (GTC)";
  export const TIME_LIMIT_ORDER = "Time limit order";
  export const ICEBERG_ORDER = "Iceberg order";
  export const TWAP_ORDER = "TWAP order";
  export const VWAP_ORDER = "VWAP order";
  
  // APIs
  export const REST_API = "REST API";
  export const WEBSOCKET_API = "WebSocket API";
  export const FIX_API = "FIX API";
  export const GRAPHQL_API = "GraphQL API";
  export const SDK_PYTHON = "Python SDK";
  export const SDK_NODE = "Node.js/TypeScript SDK";
  export const SDK_GO = "Go SDK";
  export const SDK_JAVA = "Java SDK";
  export const SDK_CSHARP = "C#/.NET SDK";
  export const SDK_RUBY = "Ruby SDK";
  export const SDK_PHP = "PHP SDK";
  export const SDK_SWIFT = "Swift SDK";
  export const SDK_KOTLIN = "Kotlin SDK";
  export const CLI_TOOL = "CLI tool";
  
  // Testnet
  export const TESTNET = "Testnet/Testnet trading";
  export const DEMO_TRADING = "Demo trading (模拟交易)";
  export const SANDBOX = "Sandbox environment";
  
  // Tools
  export const PORTFOLIO = "Portfolio tracker";
  export const TAX_CALCULATOR = "Tax calculator";
  export const CALENDAR = "Economic calendar";
  export const MARGIN_CALCULATOR = "Margin calculator";
  export const PROFIT_CALCULATOR = "Profit calculator";
  export const FEE_CALCULATOR = "Fee calculator";
  export const CONVERTER = "Unit converter";
  export const BLOCK_EXPLORER = "Block explorer";
}

// ============================================================
// CUSTOMER SUPPORT
// ============================================================

export namespace Support {
  export const LIVE_CHAT = "24/7 Live chat";
  export const EMAIL_SUPPORT = "Email support";
  export const PHONE_SUPPORT = "Phone support";
  export const TICKET_SYSTEM = "Ticket system";
  export const FAQ = "FAQ/Help center";
  export const KNOWLEDGE_BASE = "Knowledge base";
  export const VIDEO_GUIDES = "Video guides";
  export const COMMUNITY_FORUM = "Community forum";
  export const SOCIAL_MEDIA = "Social media support";
  export const WHATSAPP = "WhatsApp support";
  export const LINE = "LINE support (Japan)";
  export const WECHAT = "WeChat support (China)";
  export const TELEGRAM_SUPPORT = "Telegram support";
  export const REGIONAL_OFFICES = "Regional offices";
  export const LOCAL_LANGUAGE = "Local language support";
}

// ============================================================
// NATIVE TOKEN
// ============================================================

export namespace NativeToken {
  export const TOKEN_NAME = "TigerEx Token (TIGER)";
  export const TOKEN_UTILITY = "Utility token for fee discount";
  export const TOKEN_STAKING = "Stake for reduced fees";
  export const TOKEN_VIP = "VIP tier advancement";
  export const TOKEN_GOVERNANCE = "Governance voting";
  export const TOKEN_LAUNCH = "Token generation event";
  export const TOKEN_AIRDROP = "Token airdrop";
  export const TOKEN_BURN = "Token burn mechanism";
  export const TOKEN_BUYBACK = "Token buyback program";
  export const TOKEN_REWARDS = "Token rewards";
  export const TOKEN_EXCLUSIVE = "Exclusive access";
  export const TOKEN_NFT = "NFT membership";
}

// ============================================================
// ALL FEATURES EXPORT
// ============================================================

export const ALL_FEATURES = {
  ...Object.values(TradingProducts),
  ...Object.values(EarnProducts),
  ...Object.values(Payments),
  ...Object.values(NFTWeb3),
  ...Object.values(TradingBots),
  ...Object.values(Institutional),
  ...Object.values(Security),
  ...Object.values(FeesVIP),
  ...Object.values(CommunityGrowth),
  ...Object.values(Platform),
  ...Object.values(Support),
  ...Object.values(NativeToken),
};

export const FEATURE_COUNT = ALL_FEATURES.length;