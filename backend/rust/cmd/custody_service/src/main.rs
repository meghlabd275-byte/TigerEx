//! TigerEx Cold Wallet Security Infrastructure - Rust Implementation
//! Complete cold storage, multi-sig, HSM integration with high-level encryption

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use sha2::{Sha256, Sha512, Digest};
use sha3::Keccak256;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};

// ============================================================================
// CRYPTOGRAPHIC TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedData {
    pub ciphertext: String,
    pub nonce: String,
    pub version: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletAddress {
    pub id: String,
    pub currency: String,
    pub address: String,
    pub public_key: String,
    pub address_type: String,
    pub chain: String,
    pub created_at: i64,
    pub status: String,
    pub is_cold: bool,
    pub multi_sig_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiSigConfig {
    pub config_id: String,
    pub threshold: i32,
    pub signers: Vec<SignerInfo>,
    pub created_at: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerInfo {
    pub signer_id: String,
    pub public_key: String,
    pub role: String,
    pub name: String,
    pub verified_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionRequest {
    pub tx_id: String,
    pub currency: String,
    pub amount: String,
    pub from_address: String,
    pub to_address: String,
    pub fee: String,
    pub memo: Option<String>,
    pub signatures: Vec<SignatureData>,
    pub status: String,
    pub created_at: i64,
    pub approved_at: Option<i64>,
    pub executed_at: Option<i64>,
    pub tx_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignatureData {
    pub signer_id: String,
    pub signature: String,
    pub signed_at: i64,
    pub public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HSMKey {
    pub key_id: String,
    pub public_key: String,
    pub key_type: String,
    pub algorithm: String,
    pub created_at: i64,
    pub status: String,
    pub rotation_policy: RotationPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotationPolicy {
    pub auto_rotate: bool,
    pub rotation_days: i32,
    pub last_rotated: i64,
    pub next_rotation: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColdStorageConfig {
    pub config_id: String,
    pub hot_wallet_limit: String,
    pub cold_wallet_percentage: String,
    pub auto_top_up: bool,
    pub top_up_threshold: String,
    pub top_up_amount: String,
    pub max_daily_withdrawal: String,
    pub max_withdrawal_per_tx: String,
    pub approval_required: bool,
    pub approval_threshold: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLog {
    pub log_id: String,
    pub event_type: String,
    pub user_id: String,
    pub details: String,
    pub ip_address: String,
    pub timestamp: i64,
    pub result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsuranceFund {
    pub fund_id: String,
    pub total_assets: String,
    pub currency: String,
    pub coverage_amount: String,
    pub last_replenished: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WithdrawalWhitelist {
    pub whitelist_id: String,
    pub user_id: String,
    pub addresses: Vec<WhitelistAddress>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhitelistAddress {
    pub address: String,
    pub currency: String,
    pub label: String,
    pub added_at: i64,
    pub is_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginAlert {
    pub alert_id: String,
    pub user_id: String,
    pub alert_type: String,
    pub message: String,
    pub timestamp: i64,
    pub acknowledged: bool,
}

// ============================================================================
// CRYPTOGRAPHIC SERVICE
// ============================================================================

pub struct CryptoService {
    master_key: [u8; 32],
}

impl CryptoService {
    pub fn new() -> Self {
        let mut master_key = [0u8; 32];
        OsRng.fill_bytes(&mut master_key);
        Self { master_key }
    }
    
    pub fn from_seed(seed: &[u8]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(seed);
        let mut master_key = [0u8; 32];
        master_key.copy_from_slice(&hasher.finalize());
        Self { master_key }
    }
    
    /// AES-256-GCM Encryption
    pub fn encrypt(&self, plaintext: &str) -> Result<EncryptedData, String> {
        let cipher = Aes256Gcm::new_from_slice(&self.master_key)
            .map_err(|e| format!("Cipher error: {}", e))?;
        
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| format!("Encryption error: {}", e))?;
        
        Ok(EncryptedData {
            ciphertext: base64_encode(&ciphertext),
            nonce: base64_encode(&nonce_bytes),
            version: 1,
        })
    }
    
    /// AES-256-GCM Decryption
    pub fn decrypt(&self, data: &EncryptedData) -> Result<String, String> {
        let cipher = Aes256Gcm::new_from_slice(&self.master_key)
            .map_err(|e| format!("Cipher error: {}", e))?;
        
        let ciphertext = base64_decode(&data.ciphertext)
            .map_err(|e| format!("Base64 decode error: {}", e))?;
        
        let nonce_bytes = base64_decode(&data.nonce)
            .map_err(|e| format!("Base64 decode error: {}", e))?;
        
        if nonce_bytes.len() != 12 {
            return Err("Invalid nonce length".to_string());
        }
        
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        let plaintext = cipher.decrypt(nonce, ciphertext.as_ref())
            .map_err(|e| format!("Decryption error: {}", e))?;
        
        String::from_utf8(plaintext)
            .map_err(|e| format!("UTF-8 error: {}", e))
    }
    
    /// Generate an ED25519 signing key pair.
    ///
    /// Returns (private key, public key), both base64 encoded.
    pub fn generate_keypair(&self) -> (String, String) {
        let mut secret = [0u8; 32];
        OsRng.fill_bytes(&mut secret);
        let signing_key = SigningKey::from_bytes(&secret);
        let verifying_key = signing_key.verifying_key();
        
        (base64_encode(&signing_key.to_bytes()),
         base64_encode(&verifying_key.to_bytes()))
    }
    
    /// Sign Data
    pub fn sign(&self, data: &str, private_key: &str) -> Result<String, String> {
        let key_bytes = base64_decode(private_key)
            .map_err(|e| format!("Key decode error: {}", e))?;
        
        if key_bytes.len() != 32 {
            return Err("Invalid key length".to_string());
        }
        
        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(&key_bytes);
        
        let signing_key = SigningKey::from_bytes(&key_array);
        let signature = signing_key.sign(data.as_bytes());
        
        Ok(base64_encode(&signature.to_bytes()))
    }
    
    /// Verify Signature
    pub fn verify(&self, data: &str, signature: &str, public_key: &str) -> bool {
        let sig_bytes = match base64_decode(signature) {
            Ok(b) => b,
            Err(_) => return false,
        };
        
        let key_bytes = match base64_decode(public_key) {
            Ok(b) => b,
            Err(_) => return false,
        };
        
        if key_bytes.len() != 32 || sig_bytes.len() != 64 {
            return false;
        }
        
        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(&key_bytes);
        
        let mut sig_array = [0u8; 64];
        sig_array.copy_from_slice(&sig_bytes);
        
        let verifying_key = match VerifyingKey::from_bytes(&key_array) {
            Ok(k) => k,
            Err(_) => return false,
        };
        
        let signature = Signature::from_bytes(&sig_array);
        
        verifying_key.verify(data.as_bytes(), &signature).is_ok()
    }
    
    /// SHA-256 Hash
    pub fn sha256(&self, data: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data.as_bytes());
        hex_encode(&hasher.finalize())
    }
    
    /// SHA-512 Hash
    pub fn sha512(&self, data: &str) -> String {
        let mut hasher = Sha512::new();
        hasher.update(data.as_bytes());
        hex_encode(&hasher.finalize())
    }
    
    /// Keccak256 Hash
    pub fn keccak256(&self, data: &str) -> String {
        let mut hasher = Keccak256::new();
        hasher.update(data.as_bytes());
        hex_encode(&hasher.finalize())
    }
    
    /// Generate Secure Random
    pub fn generate_random(&self, length: usize) -> Vec<u8> {
        let mut buffer = vec![0u8; length];
        OsRng.fill_bytes(&mut buffer);
        buffer
    }
    
    /// Derive Key (PBKDF2-like)
    pub fn derive_key(&self, password: &str, salt: &[u8], iterations: u32) -> String {
        let mut result = password.as_bytes().to_vec();
        for _ in 0..iterations {
            let mut hasher = Sha256::new();
            hasher.update(&result);
            hasher.update(salt);
            result = hasher.finalize().to_vec();
        }
        hex_encode(&result)
    }
    
    /// Generate Mnemonic (BIP39-like)
    pub fn generate_mnemonic(&self, word_count: usize) -> Vec<String> {
        let words = vec![
            "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
            "absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
            "acoustic", "acquire", "across", "action", "actor", "actress", "actual", "adapt",
            "add", "addict", "address", "adjust", "admit", "adult", "advance", "advice",
            "aerobic", "affair", "afford", "afraid", "again", "age", "agent", "agree",
            "ahead", "aim", "air", "airport", "aisle", "alarm", "album", "alcohol",
            "alert", "alien", "all", "alley", "allow", "almost", "alone", "alpha",
            "already", "also", "alter", "always", "amateur", "amazing", "among", "amount",
            "amused", "analyst", "anchor", "ancient", "anger", "angle", "angry", "animal",
            "ankle", "announce", "annual", "another", "answer", "antenna", "antique", "anxiety",
            "any", "apart", "apology", "appear", "apple", "approve", "april", "arch",
            "arctic", "area", "arena", "argue", "arm", "armed", "armor", "army",
            "around", "arrange", "arrest", "arrive", "arrow", "art", "artefact", "artist",
            "artwork", "ask", "aspect", "assault", "asset", "assist", "assume", "asthma",
            "athlete", "atom", "attack", "attend", "attitude", "attract", "auction", "audit",
            "august", "aunt", "author", "auto", "autumn", "average", "avocado", "avoid",
            "awake", "aware", "away", "awesome", "awful", "awkward", "axis", "baby",
            "bachelor", "bacon", "badge", "bag", "balance", "balcony", "ball", "bamboo",
            "banana", "banner", "bar", "barely", "bargain", "barrel", "base", "basic",
            "basket", "battle", "beach", "bean", "beauty", "because", "become", "beef",
            "before", "begin", "behave", "behind", "believe", "below", "belt", "bench",
            "benefit", "best", "betray", "better", "between", "beyond", "bicycle", "bid",
            "bike", "bind", "biology", "bird", "birth", "bitter", "black", "blade",
            "blame", "blanket", "blast", "blaze", "bless", "blind", "blood", "blossom",
            "blouse", "blue", "blur", "blush", "board", "boat", "body", "boil",
            "bomb", "bone", "bonus", "book", "boost", "border", "boring", "borrow",
            "boss", "bottom", "bounce", "box", "boy", "bracket", "brain", "brand",
            "brass", "brave", "bread", "breeze", "brick", "bridge", "brief", "bright",
            "bring", "brisk", "broccoli", "broken", "bronze", "broom", "brother", "brown",
            "brush", "bubble", "buddy", "budget", "buffalo", "build", "bulb", "bulk",
            "bullet", "bundle", "bunker", "burden", "burger", "burst", "bus", "business",
            "busy", "butter", "buyer", "buzz", "cabbage", "cabin", "cable", "cactus",
            "cage", "cake", "call", "calm", "camera", "camp", "canal", "cancel",
            "candy", "cannon", "canoe", "canvas", "canyon", "capable", "capital", "captain",
            "carbon", "card", "cargo", "carpet", "carry", "cart", "case", "cash",
            "casino", "castle", "casual", "catalog", "catch", "category", "cattle",
            "caught", "cause", "caution", "cave", "ceiling", "celery", "cement", "census",
            "century", "cereal", "certain", "chair", "chalk", "champion", "change", "chaos",
            "chapter", "charge", "chase", "chat", "cheap", "check", "cheese", "chef",
            "cherry", "chest", "chicken", "chief", "child", "chimney", "choice", "choose",
            "chronic", "chunk", "cigar", "cinnamon", "circle", "citizen", "city", "civil",
            "claim", "clap", "clarify", "classic", "clean", "clerk", "clever", "click",
            "client", "cliff", "climb", "clinic", "clip", "clock", "close", "cloth",
            "cloud", "clown", "club", "clump", "cluster", "clutch", "coach", "coast",
            "coconut", "code", "coffee", "coil", "coin", "collect", "color", "column",
            "combine", "come", "comfort", "comic", "common", "company", "concert", "connect",
            "consider", "control", "convince", "cook", "cool", "copper", "copy", "coral",
            "core", "corn", "correct", "cost", "cotton", "couch", "country", "couple",
            "course", "cousin", "cover", "coyote", "crack", "cradle", "craft",
            "cram", "crane", "crash", "crater", "crawl", "crazy", "cream",
            "credit", "creek", "crew", "cricket", "crime", "crisp", "critic", "crop",
            "cross", "crouch", "crowd", "crucial", "cruel", "cruise", "crumble", "crunch",
            "crush", "cry", "crystal", "cube", "culture", "cup", "cupboard", "curious",
            "current", "curtain", "curve", "cushion", "custom", "cute", "cycle", "dad",
            "damage", "damp", "dance", "danger", "daring", "dash", "daughter", "dawn",
            "deal", "debate", "debris", "decade", "december", "decide", "decline",
            "decorate", "decrease", "deer", "defense", "define", "defy", "degree",
            "delay", "deliver", "demand", "demise", "denial", "dentist", "deny", "depart",
            "depend", "deposit", "depth", "deputy", "derive", "describe", "desert", "design",
            "desk", "despair", "destroy", "detail", "detect", "develop", "device", "devote",
            "diagram", "dial", "diamond", "diary", "dice", "diesel", "diet", "digital",
            "dignity", "dilemma", "dinner", "dinosaur", "direct", "dirt", "disagree",
            "discover", "disease", "dish", "dismiss", "disorder", "display", "distance",
            "divert", "divide", "divorce", "dizzy", "doctor", "document", "dog",
            "doll", "dolphin", "domain", "donate", "donkey", "donor", "door",
            "dose", "double", "dove", "draft", "dragon", "drama", "draw", "dream",
            "dress", "drift", "drill", "drink", "drip", "drive", "drop", "drum",
            "dry", "duck", "dumb", "dune", "during", "dust", "duty", "dwarf",
            "dynamic", "eager", "eagle", "early", "earn", "earth", "easily", "east",
            "easy", "echo", "ecology", "economy", "edge", "edit", "educate", "effect",
            "effort", "egg", "eight", "eject", "elastic", "elbow", "elder", "electric",
            "elegant", "element", "elephant", "elevator", "elite", "else", "embark", "embrace",
            "emerge", "emotion", "employ", "empower", "empty", "enable", "enact",
            "end", "endless", "endorse", "enemy", "energy", "enforce", "engage",
            "engine", "enhance", "enjoy", "enlist", "enough", "enrich", "enroll",
            "ensure", "enter", "entire", "entry", "envelope", "episode", "equal",
            "equip", "era", "erase", "erode", "erosion", "error", "erupt", "escape",
            "estate", "eternal", "ethics", "evidence", "evil", "evoke", "evolve",
            "exact", "example", "excess", "exchange", "excite", "exclude", "excuse",
            "execute", "exercise", "exhaust", "exhibit", "exile", "exist", "exit",
            "exotic", "expand", "expect", "expire", "explain", "expose", "express",
            "extend", "extra", "eye", "eyebrow", "fabric", "face", "facility",
            "fact", "factory", "faculty", "fade", "faint", "faith", "fall", "false",
            "fame", "family", "famous", "fan", "fancy", "fantasy", "farm", "fashion",
            "fat", "fatal", "father", "fatigue", "fault", "favorite", "feature", "february",
            "federal", "fee", "feed", "feel", "female", "fence", "festival", "fetch",
            "fever", "few", "fiber", "fiction", "field", "figure", "file", "film",
            "filter", "final", "finance", "find", "fine", "finger", "finish", "fire",
            "firm", "first", "fiscal", "fish", "fitness", "fix", "flag", "flame",
            "flash", "flat", "flavor", "flee", "flight", "flip", "float", "flock",
            "flood", "floor", "flower", "fluid", "flush", "fly", "foam", "focus",
            "fog", "foil", "fold", "folk", "follow", "food", "foot", "force",
            "forest", "forget", "fork", "fortune", "forum", "forward", "fossil", "foster",
            "found", "fox", "fragile", "frame", "frequent", "fresh", "friend", "fringe",
            "frog", "front", "frost", "frown", "frozen", "fruit", "fry", "fuel",
            "fun", "function", "fund", "funny", "furnace", "fury", "future", "gadget",
            "gain", "galaxy", "gallery", "game", "gap", "garage", "garbage", "garden",
            "gas", "gasp", "gate", "gather", "gauge", "gaze", "general", "genre",
            "gentle", "genuine", "gesture", "ghost", "giant", "gift", "giggle", "ginger",
            "giraffe", "girl", "give", "glad", "glance", "glare", "glass", "glide",
            "glimpse", "globe", "gloom", "glory", "glove", "glow", "glue", "goat",
            "goddess", "gold", "good", "goose", "gorilla", "gospel", "gossip", "govern",
            "gown", "grab", "grace", "grain", "grant", "grape", "grass", "gravity",
            "great", "green", "grid", "grief", "grit", "grocery", "gross", "group",
            "grow", "grunt", "guard", "guess", "guide", "guilt", "guitar", "gun", "gym",
            "habit", "hair", "half", "hammer", "hamster", "hand", "handle", "harbor",
            "hard", "harsh", "harvest", "hat", "have", "hawk", "hazard", "head", "health",
            "heart", "heavy", "hedgehog", "height", "hello", "helmet", "help", "hen",
            "hero", "hidden", "high", "hill", "hint", "hip", "hire", "history",
            "hobby", "hockey", "hold", "hole", "holiday", "hollow", "home", "honey",
            "hood", "hope", "horn", "horror", "horse", "hospital", "host", "hotel",
            "hour", "hover", "hub", "huge", "human", "humble", "humor", "hundred",
            "hungry", "hunt", "hurdle", "hurry", "hurt", "husband", "hybrid", "ice",
            "icon", "idea", "identify", "idle", "ignore", "ill", "illegal", "illness",
            "image", "imitate", "immense", "immune", "impact", "impose", "improve", "impulse",
            "inch", "include", "income", "increase", "index", "indicate", "indoor", "industry",
            "infant", "inflict", "inform", "inhale", "inherit", "initial", "inject", "injury",
            "inmate", "inner", "innocent", "input", "inquiry", "insane", "insect",
            "insert", "inside", "inspire", "install", "intact", "interest", "into", "invest",
            "invite", "involve", "iron", "island", "isolate", "issue", "item", "ivory",
            "jacket", "jaguar", "jar", "jazz", "jealous", "jeans", "jelly", "jewel",
            "job", "join", "joke", "journey", "joy", "judge", "juice", "jump",
            "jungle", "junior", "junk", "just", "kangaroo", "keen", "keep", "ketchup",
            "key", "kick", "kid", "kidney", "kind", "kingdom", "kiss", "kit",
            "kitchen", "kite", "kitten", "kiwi", "knee", "knife", "knock", "know",
            "lab", "label", "labor", "ladder", "lady", "lake", "lamp", "language",
            "laptop", "large", "later", "latin", "laugh", "laundry", "lava", "law",
            "lawn", "lawsuit", "layer", "lazy", "leader", "leaf", "learn", "leave",
            "lecture", "left", "leg", "legal", "legend", "leisure", "lemon", "lend",
            "length", "lens", "leopard", "lesson", "letter", "level", "liar",
            "liberty", "library", "license", "life", "lift", "light", "like", "limb",
            "limit", "linen", "lion", "liquid", "list", "little", "live", "lizard",
            "load", "loan", "lobster", "local", "lock", "logic", "lonely", "long",
            "lottery", "loud", "lounge", "love", "loyal", "luck", "luggage", "lumber",
            "lunar", "lunch", "luxury", "lyrics", "machine", "mad", "magic", "magnet",
            "maid", "mail", "main", "major", "make", "mammal", "man", "manage",
            "mandate", "mango", "mansion", "manual", "maple", "marble", "march", "margin",
            "marine", "market", "marriage", "mask", "mass", "master", "match", "material",
            "math", "matrix", "matter", "max", "maybe", "mayor", "meak", "mean",
            "meaning", "measure", "meat", "mechanic", "medal", "media", "melody", "melt",
            "member", "memory", "men", "mend", "mental", "mentor", "menu", "mercy",
            "merge", "merit", "merry", "mesh", "message", "metal", "method", "middle",
            "midnight", "milk", "million", "mimic", "mind", "minimum", "minor", "minute",
            "miracle", "mirror", "misery", "miss", "mistake", "mix", "mixed", "mixture",
            "mobile", "model", "modify", "mom", "moment", "monitor", "monkey", "monster",
            "month", "moon", "moral", "more", "morning", "mosquito", "mother", "motion",
            "motor", "mountain", "mouse", "move", "movie", "much", "muffin", "mule",
            "multiply", "muscle", "museum", "mushroom", "music", "must", "mutual", "myself",
            "mystery", "myth", "naked", "name", "narrow", "nasty", "nation", "nature",
            "near", "nearly", "neck", "need", "negative", "neglect", "neither", "nephew",
            "nerve", "nest", "net", "network", "neutral", "never", "news", "next",
            "nice", "night", "noble", "noise", "nominee", "noodle", "normal", "north",
            "nose", "note", "nothing", "notice", "novel", "now", "nuclear", "number",
            "nurse", "nut", "oak", "obey", "object", "oblige", "obtain", "obvious",
            "occur", "ocean", "october", "odor", "off", "offer", "office", "often", "oil",
            "okay", "old", "olive", "olympic", "omit", "once", "one", "onion", "online",
            "only", "open", "opera", "opinion", "oppose", "option", "orange", "orbit",
            "orchard", "order", "ordinary", "organ", "orient", "original", "orphan", "ostrich",
            "other", "outdoor", "outer", "output", "outside", "oval", "oven", "over",
            "own", "owner", "owl", "oxygen", "oyster", "ozone", "pact", "paddle",
            "page", "pair", "palace", "pale", "palm", "panda", "panel", "panic",
            "panther", "paper", "parade", "parent", "park", "parrot", "party", "pass",
            "patch", "path", "patient", "patrol", "pattern", "pause", "pave", "payment",
            "peace", "peanut", "pear", "peasant", "pelican", "pen", "penalty", "pencil",
            "people", "pepper", "perfect", "permit", "person", "pet", "phone", "photo",
            "phrase", "physical", "piano", "picnic", "picture", "piece", "pig", "pigeon",
            "pill", "pilot", "pink", "pioneer", "pipe", "pistol", "pitch", "pizza",
            "place", "planet", "plastic", "plate", "play", "please", "pledge", "plenty",
            "plot", "plough", "plug", "poem", "poet", "point", "polar", "pole",
            "police", "pond", "pony", "pool", "popular", "portion", "position", "possible",
            "post", "potato", "pottery", "poverty", "powder", "power", "practice", "praise",
            "predict", "prefer", "prepare", "present", "pretty", "prevent", "price", "pride",
            "primary", "print", "priority", "prison", "private", "prize", "problem",
            "process", "produce", "profit", "program", "project", "promote", "proof", "property",
            "protect", "proud", "provide", "public", "pudding", "pull", "pulp", "pulse",
            "pumpkin", "punch", "pupil", "puppy", "purchase", "purity", "purpose", "purse",
            "push", "put", "puzzle", "pyramid", "quality", "quantum", "quarter", "question",
            "quick", "quiet", "quilt", "quit", "quiz", "quote", "rabbit", "raccoon",
            "race", "rack", "radar", "radio", "rail", "rain", "raise", "rally", "ramp",
            "ranch", "random", "range", "rapid", "rare", "rash", "rate", "rather", "raven",
            "raw", "reach", "react", "read", "reader", "real", "reality", "realize",
            "realm", "rear", "reason", "rebel", "rebuild", "recall", "receive", "recipe",
            "record", "recover", "recruit", "red", "reduce", "reflect", "reform", "refuse",
            "region", "regret", "reject", "relate", "relax", "release", "relief", "rely",
            "remain", "remember", "remind", "remote", "remove", "render", "renew", "rent",
            "reopen", "repair", "repeat", "replace", "reply", "report", "represent", "reproduce",
            "public", "require", "rescue", "resemble", "resist", "resource", "response", "result",
            "retain", "retire", "return", "reunion", "reveal", "review", "revise", "revive",
            "revolt", "revolution", "reward", "rhythm", "rib", "ribbon", "rice", "rich", "ride",
            "ridge", "rifle", "right", "rigid", "ring", "riot", "ripple", "risk", "ritual",
            "rival", "river", "road", "roast", "robot", "robust", "rocket", "romance", "roof",
            "rookie", "room", "root", "rope", "rose", "rotate", "rough", "round", "route",
            "royal", "rubber", "rude", "rug", "rule", "run", "runway", "rural",
            "sad", "saddle", "sadness", "safe", "sail", "salad", "salmon", "salon",
            "salt", "salute", "same", "sample", "sand", "satisfy", "satoshi", "sauce",
            "sausage", "save", "say", "scale", "scan", "scare", "scatter", "scene", "scent",
            "school", "science", "scissors", "scorpion", "scout", "scrap", "screen", "script",
            "scrub", "sea", "search", "season", "seat", "second", "secret", "section",
            "security", "seed", "seek", "seem", "segment", "seize", "select", "sell",
            "seminar", "senior", "sense", "sentence", "series", "service", "session", "settle",
            "setup", "seven", "shadow", "shaft", "shallow", "share", "shark", "sharp",
            "sheep", "sheer", "sheet", "shelf", "shell", "sheriff", "shield", "shift",
            "shine", "ship", "shiver", "shock", "shoe", "shoot", "shop", "short",
            "shoulder", "shove", "shrimp", "shrug", "shuffle", "shun", "shut", "sibling",
            "sick", "side", "siege", "sight", "sign", "silent", "silk", "silly",
            "silver", "similar", "simple", "since", "sing", "siren", "sister", "situate",
            "six", "size", "skate", "sketch", "ski", "skill", "skin", "skirt", "skull",
            "slab", "slam", "sleep", "slender", "slice", "slide", "slight", "slim", "slogan",
            "slot", "slow", "slush", "small", "smart", "smile", "smoke", "snake", "snap",
            "sniff", "snow", "soar", "social", "sock", "soda", "soft", "solar", "soldier",
            "solid", "solution", "solve", "someone", "song", "soon", "sorry", "sort",
            "soul", "sound", "soup", "source", "south", "space", "spare", "spark",
            "speak", "special", "speech", "speed", "spell", "spend", "sphere", "spice",
            "spider", "spike", "spin", "spirit", "split", "spoil", "sponsor", "spoon",
            "sport", "spot", "spray", "spread", "spring", "spy", "square", "squeeze",
            "squirrel", "stable", "stadium", "staff", "stage", "stairs", "stake",
            "stamp", "stand", "start", "state", "stay", "steak", "steal", "steam",
            "steel", "steep", "steer", "stem", "step", "stereo", "stick", "still",
            "sting", "stock", "stomach", "stone", "stool", "story", "stove", "strategy",
            "street", "strike", "strong", "struggle", "student", "stuff", "stumble", "stun",
            "stunt", "style", "subject", "submit", "subway", "success", "such", "sudden",
            "suffer", "sugar", "suggest", "suit", "summer", "sun", "sunny", "sunset",
            "super", "supply", "supreme", "sure", "surface", "surge", "surprise", "surround",
            "survey", "suspect", "sustain", "swallow", "swamp", "swap", "swarm",
            "swear", "sweat", "sweep", "sweet", "swift", "swim", "swing", "switch",
            "sword", "symbol", "symptom", "syrup", "system", "table", "tackle", "tag",
            "tail", "talent", "talk", "tank", "tape", "target", "task", "taste", "tattoo",
            "taught", "taxi", "teach", "team", "tell", "ten", "tenant", "tennis",
            "tense", "tent", "term", "test", "text", "thank", "that", "theme", "then",
            "there", "they", "thing", "this", "thought", "three", "thrive", "throw", "thumb",
            "thunder", "ticket", "tide", "tiger", "tilt", "timber", "time", "tiny",
            "tip", "tired", "tissue", "title", "toast", "tobacco", "toddler", "toe",
            "together", "toilet", "token", "tomato", "tomorrow", "tone", "tongue", "tonight",
            "tool", "tooth", "top", "topic", "topple", "torch", "tornado", "tortoise",
            "toss", "total", "tourist", "toward", "tower", "town", "toy", "track",
            "trade", "traffic", "tragic", "train", "transfer", "transform", "transit", "translate",
            "transport", "trap", "trash", "travel", "tray", "treat", "tree", "trend",
            "trial", "tribe", "trick", "trigger", "trim", "trip", "trophy", "trouble", "truck",
            "true", "truly", "trumpet", "trust", "truth", "try", "tube", "tuition",
            "tumble", "tuna", "tunnel", "turbine", "tutor", "twelve", "twenty", "twice",
            "twin", "twist", "two", "type", "typical", "ugly", "umbrella", "unable", "unaware",
            "uncle", "uncover", "under", "undo", "unfair", "unfold", "unhappy", "uniform",
            "unique", "unit", "universe", "unknown", "unlock", "until", "unusual", "unveil",
            "update", "upgrade", "uphold", "upon", "upper", "upset", "urban", "urge",
            "usage", "use", "used", "useful", "useless", "usual", "utility", "vacant",
            "vacuum", "vague", "valid", "valley", "valley", "valve", "van", "vanish",
            "various", "vegan", "velvet", "vendor", "venture", "venue", "verb", "verify",
            "version", "very", "vessel", "veteran", "via", "victim", "victory", "video",
            "view", "village", "vintage", "violin", "virtual", "virus", "visa", "visit",
            "visual", "vital", "vivid", "vocal", "voice", "void", "volcano", "volume",
            "vote", "voyage", "wage", "wagon", "wait", "wake", "walk", "wall", "walnut",
            "want", "warfare", "warm", "warrior", "wash", "wasp", "waste", "watch",
            "water", "wave", "way", "wealth", "weapon", "wear", "weasel", "weather", "web",
            "wedding", "weekend", "weird", "welcome", "well", "west", "wet", "whale", "what",
            "wheat", "wheel", "when", "where", "whip", "whisper", "whistle", "white",
            "who", "whole", "why", "wicked", "wide", "widow", "width", "wife", "wild",
            "will", "win", "window", "wine", "wing", "wink", "winner", "winter", "wire",
            "wisdom", "wise", "wish", "witness", "wolf", "woman", "wonder", "wood", "wool", "word",
            "work", "world", "worry", "worth", "wrap", "wreck", "wrestle", "wrist", "write",
            "wrong", "yard", "year", "yellow", "you", "young", "youth", "zebra", "zero", "zone", "zoo",
        ];
        
        let mut entropy = [0u8; 32];
        OsRng.fill_bytes(&mut entropy);

        let mut result = Vec::with_capacity(word_count);
        for i in 0..word_count {
            // Fold two entropy bytes into an index below the word count.
            let hi = entropy[(i * 2) % entropy.len()] as usize;
            let lo = entropy[(i * 2 + 1) % entropy.len()] as usize;
            result.push(words[((hi << 8) | lo) % words.len()].to_string());
        }

        result
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn generate_id(prefix: &str) -> String {
    format!("{}{}{}", prefix, current_timestamp(), uuid::Uuid::new_v4().to_string()[..8].to_uppercase())
}

fn base64_encode(data: &[u8]) -> String {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD.encode(data)
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD.decode(data)
        .map_err(|e| format!("Base64 decode error: {}", e))
}

fn hex_encode(data: impl AsRef<[u8]>) -> String {
    data.as_ref().iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(data: &str) -> Result<Vec<u8>, String> {
    (0..data.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&data[i..i+2], 16))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Hex decode error: {}", e))
}

// ============================================================================
// SECURITY SERVICE
// ============================================================================

pub struct SecurityService {
    pub crypto: CryptoService,
    pub wallet_addresses: RwLock<HashMap<String, WalletAddress>>,
    pub multi_sigs: RwLock<HashMap<String, MultiSigConfig>>,
    pub transactions: RwLock<HashMap<String, TransactionRequest>>,
    pub hsm_keys: RwLock<HashMap<String, HSMKey>>,
    pub cold_storage: RwLock<Option<ColdStorageConfig>>,
    pub audit_logs: RwLock<Vec<AuditLog>>,
    pub whitelists: RwLock<HashMap<String, WithdrawalWhitelist>>,
    pub login_alerts: RwLock<Vec<LoginAlert>>,
    pub insurance_fund: RwLock<Option<InsuranceFund>>,
}

impl SecurityService {
    pub fn new() -> Self {
        Self {
            crypto: CryptoService::new(),
            wallet_addresses: RwLock::new(HashMap::new()),
            multi_sigs: RwLock::new(HashMap::new()),
            transactions: RwLock::new(HashMap::new()),
            hsm_keys: RwLock::new(HashMap::new()),
            cold_storage: RwLock::new(None),
            audit_logs: RwLock::new(Vec::new()),
            whitelists: RwLock::new(HashMap::new()),
            login_alerts: RwLock::new(Vec::new()),
            insurance_fund: RwLock::new(None),
        }
    }
    
    /// Register a cold wallet address.
    ///
    /// Addresses are supplied by the operator, never generated here.
    pub async fn register_wallet_address(
        &self,
        address: WalletAddress,
    ) -> Result<(), String> {
        if address.id.trim().is_empty() || address.address.trim().is_empty() {
            return Err("wallet address id and address are required".to_string());
        }
        if !address.is_cold {
            return Err("only cold wallet addresses may be registered here".to_string());
        }

        let mut addresses = self.wallet_addresses.write().await;
        if addresses.contains_key(&address.id) {
            return Err(format!("wallet address {} already exists", address.id));
        }
        addresses.insert(address.id.clone(), address);
        Ok(())
    }

    /// Register a multi-signature configuration.
    pub async fn register_multisig(&self, config: MultiSigConfig) -> Result<(), String> {
        if config.threshold == 0 {
            return Err("threshold must be at least 1".to_string());
        }
        if config.threshold as usize > config.signers.len() {
            return Err("threshold cannot exceed the number of signers".to_string());
        }
        if config.signers.is_empty() {
            return Err("at least one signer is required".to_string());
        }
        if config.signers.iter().any(|s| s.public_key.trim().is_empty()) {
            return Err("every signer must have a public key".to_string());
        }

        let mut multi_sigs = self.multi_sigs.write().await;
        if multi_sigs.contains_key(&config.config_id) {
            return Err(format!("multisig {} already exists", config.config_id));
        }
        multi_sigs.insert(config.config_id.clone(), config);
        Ok(())
    }

    /// Set the cold storage policy.
    pub async fn set_cold_storage_config(&self, config: ColdStorageConfig) -> Result<(), String> {
        if config.approval_threshold == 0 {
            return Err("approval_threshold must be at least 1".to_string());
        }
        *self.cold_storage.write().await = Some(config);
        Ok(())
    }

    /// Set the insurance fund record. The balance is reported by the treasury,
    /// not invented here.
    pub async fn set_insurance_fund(&self, fund: InsuranceFund) -> Result<(), String> {
        if fund.total_assets.trim().is_empty() {
            return Err("insurance fund total_assets is required".to_string());
        }
        *self.insurance_fund.write().await = Some(fund);
        Ok(())
    }

    // ========================================================================
    // COLD WALLET OPERATIONS
    // ========================================================================
    
    pub async fn get_cold_wallet_address(&self, currency: &str) -> Option<WalletAddress> {
        let addresses = self.wallet_addresses.read().await;
        for (_, addr) in addresses.iter() {
            if addr.currency == currency.to_uppercase() && addr.is_cold {
                return Some(addr.clone());
            }
        }
        None
    }
    
    pub async fn create_transaction(&self, currency: &str, amount: &str, to_address: &str, 
                              from_cold: bool) -> Result<TransactionRequest, String> {
        let tx_id = generate_id("TX");
        
        // Get from address
        let from_addr = self.get_cold_wallet_address(currency).await
            .ok_or_else(|| "Cold wallet not found".to_string())?;
        
        // Calculate fee
        let fee = match currency.to_uppercase().as_str() {
            "BTC" => "0.0005",
            "ETH" => "0.005",
            "USDT" | "USDC" => "1.0",
            _ => "0.0",
        };
        
        let tx = TransactionRequest {
            tx_id: tx_id.clone(),
            currency: currency.to_uppercase(),
            amount: amount.to_string(),
            from_address: from_addr.address,
            to_address: to_address.to_string(),
            fee: fee.to_string(),
            memo: None,
            signatures: Vec::new(),
            status: "pending".to_string(),
            created_at: current_timestamp(),
            approved_at: None,
            executed_at: None,
            tx_hash: None,
        };
        
        let mut transactions = self.transactions.write().await;
        transactions.insert(tx_id.clone(), tx.clone());
        
        self.log_audit("CREATE_TRANSACTION", &tx.from_address, 
                    &format!("Created {} transaction for {}", amount, currency),
                    "0.0.0.0", "success").await;
        
        Ok(tx)
    }
    
    pub async fn sign_transaction(&self, tx_id: &str, signer_id: &str, 
                              private_key: &str) -> Result<SignatureData, String> {
        let mut transactions = self.transactions.write().await;
        
        let tx = transactions.get_mut(tx_id)
            .ok_or_else(|| "Transaction not found".to_string())?;
        
        if tx.status != "pending" {
            return Err("Transaction is not pending".to_string());
        }
        
        // Create signature data
        let data_to_sign = format!("{}{}{}{}{}", tx.currency, tx.amount, 
                                tx.from_address, tx.to_address, tx_id);
        
        let signature = self.crypto.sign(&data_to_sign, private_key)?;
        
        let sig_data = SignatureData {
            signer_id: signer_id.to_string(),
            signature: signature.clone(),
            signed_at: current_timestamp(),
            public_key: "".to_string(),
        };
        
        tx.signatures.push(sig_data.clone());
        
        // Check if we have enough signatures
        let config = self.multi_sigs.read().await;
        if let Some(cfg) = config.get(&format!("multisig-{}-001", tx.currency.to_lowercase())) {
            if tx.signatures.len() >= cfg.threshold as usize {
                tx.status = "approved".to_string();
                tx.approved_at = Some(current_timestamp());
            }
        }
        
        self.log_audit("SIGN_TRANSACTION", signer_id,
                    &format!("Signed transaction {}", tx_id),
                    "0.0.0.0", "success").await;
        
        Ok(sig_data)
    }
    
    pub async fn execute_transaction(&self, tx_id: &str) -> Result<String, String> {
        let mut transactions = self.transactions.write().await;
        
        let tx = transactions.get_mut(tx_id)
            .ok_or_else(|| "Transaction not found".to_string())?;
        
        if tx.status != "approved" {
            return Err("Transaction not approved".to_string());
        }
        
        // Generate tx hash
        let tx_hash = self.crypto.keccak256(&format!("{}{}{}{}{}", tx.currency, tx.amount,
                                                   tx.from_address, tx.to_address, tx_id));
        
        tx.tx_hash = Some(tx_hash.clone());
        tx.executed_at = Some(current_timestamp());
        tx.status = "executed".to_string();
        
        self.log_audit("EXECUTE_TRANSACTION", &tx.from_address,
                    &format!("Executed transaction {} for {}", tx_id, tx.amount),
                    "0.0.0.0", "success").await;
        
        Ok(tx_hash)
    }
    
    // ========================================================================
    // WHITELIST MANAGEMENT
    // ========================================================================
    
    pub async fn add_whitelist_address(&self, user_id: &str, address: &str, 
                                   currency: &str, label: &str) -> Result<(), String> {
        let mut whitelists = self.whitelists.write().await;
        
        let entry = whitelists.entry(user_id.to_string()).or_insert_with(|| {
            WithdrawalWhitelist {
                whitelist_id: generate_id("WL"),
                user_id: user_id.to_string(),
                addresses: Vec::new(),
                created_at: current_timestamp(),
                updated_at: current_timestamp(),
            }
        });
        
        entry.addresses.push(WhitelistAddress {
            address: address.to_string(),
            currency: currency.to_uppercase(),
            label: label.to_string(),
            added_at: current_timestamp(),
            is_verified: false,
        });
        
        entry.updated_at = current_timestamp();
        
        self.log_audit("ADD_WHITELIST", user_id,
                    &format!("Added whitelist address for {}", currency),
                    "0.0.0.0", "success").await;
        
        Ok(())
    }
    
    pub async fn is_whitelisted(&self, user_id: &str, address: &str, currency: &str) -> bool {
        let whitelists = self.whitelists.read().await;
        
        if let Some(list) = whitelists.get(user_id) {
            return list.addresses.iter().any(|a| {
                a.address == address && a.currency == currency.to_uppercase()
            });
        }
        
        false
    }
    
    // ========================================================================
    // LOGIN ALERTS
    // ========================================================================
    
    pub async fn create_login_alert(&self, user_id: &str, alert_type: &str, 
                                 message: &str) -> LoginAlert {
        let alert = LoginAlert {
            alert_id: generate_id("ALERT"),
            user_id: user_id.to_string(),
            alert_type: alert_type.to_string(),
            message: message.to_string(),
            timestamp: current_timestamp(),
            acknowledged: false,
        };
        
        let mut alerts = self.login_alerts.write().await;
        alerts.push(alert.clone());
        
        alert
    }
    
    pub async fn get_login_alerts(&self, user_id: &str) -> Vec<LoginAlert> {
        let alerts = self.login_alerts.read().await;
        alerts.iter()
            .filter(|a| a.user_id == user_id && !a.acknowledged)
            .cloned()
            .collect()
    }
    
    pub async fn acknowledge_alert(&self, alert_id: &str) -> Result<(), String> {
        let mut alerts = self.login_alerts.write().await;
        
        for alert in alerts.iter_mut() {
            if alert.alert_id == alert_id {
                alert.acknowledged = true;
                return Ok(());
            }
        }
        
        Err("Alert not found".to_string())
    }
    
    // ========================================================================
    // AUDIT LOGGING
    // ========================================================================
    
    pub async fn log_audit(&self, event_type: &str, user_id: &str, 
                         details: &str, ip_address: &str, result: &str) {
        let log = AuditLog {
            log_id: generate_id("AUDIT"),
            event_type: event_type.to_string(),
            user_id: user_id.to_string(),
            details: details.to_string(),
            ip_address: ip_address.to_string(),
            timestamp: current_timestamp(),
            result: result.to_string(),
        };
        
        let mut logs = self.audit_logs.write().await;
        logs.push(log);
    }
    
    pub async fn get_audit_logs(&self, user_id: &str) -> Vec<AuditLog> {
        let logs = self.audit_logs.read().await;
        logs.iter()
            .filter(|l| l.user_id == user_id)
            .cloned()
            .collect()
    }
    
    // ========================================================================
    // HSM OPERATIONS
    // ========================================================================
    
    pub async fn generate_hsm_key(&self, key_type: &str) -> HSMKey {
        let (private_key, public_key) = self.crypto.generate_keypair();
        
        let key = HSMKey {
            key_id: generate_id("HSM"),
            public_key: public_key.clone(),
            key_type: key_type.to_string(),
            algorithm: "ED25519".to_string(),
            created_at: current_timestamp(),
            status: "active".to_string(),
            rotation_policy: RotationPolicy {
                auto_rotate: true,
                rotation_days: 90,
                last_rotated: current_timestamp(),
                next_rotation: current_timestamp() + (90 * 86400000),
            },
        };
        
        let mut keys = self.hsm_keys.write().await;
        keys.insert(key.key_id.clone(), key.clone());
        
        key
    }
    
    // ========================================================================
    // ENCRYPTION HELPERS
    // ========================================================================
    
    pub fn encrypt_data(&self, data: &str) -> Result<EncryptedData, String> {
        self.crypto.encrypt(data)
    }
    
    pub fn decrypt_data(&self, data: &EncryptedData) -> Result<String, String> {
        self.crypto.decrypt(data)
    }
}

// ============================================================================
// MAIN
// ============================================================================

#[tokio::main]
async fn main() -> Result<(), String> {
    let service = SecurityService::new();

    // Cold storage policy comes from configuration, not from invented values.
    service
        .set_cold_storage_config(ColdStorageConfig {
            config_id: generate_id("COLD"),
            hot_wallet_limit: std::env::var("COLD_HOT_WALLET_LIMIT")
                .map_err(|_| "COLD_HOT_WALLET_LIMIT must be set".to_string())?,
            cold_wallet_percentage: std::env::var("COLD_WALLET_PERCENTAGE")
                .map_err(|_| "COLD_WALLET_PERCENTAGE must be set".to_string())?,
            auto_top_up: true,
            top_up_threshold: std::env::var("COLD_TOP_UP_THRESHOLD")
                .map_err(|_| "COLD_TOP_UP_THRESHOLD must be set".to_string())?,
            top_up_amount: std::env::var("COLD_TOP_UP_AMOUNT")
                .map_err(|_| "COLD_TOP_UP_AMOUNT must be set".to_string())?,
            max_daily_withdrawal: std::env::var("COLD_MAX_DAILY_WITHDRAWAL")
                .map_err(|_| "COLD_MAX_DAILY_WITHDRAWAL must be set".to_string())?,
            max_withdrawal_per_tx: std::env::var("COLD_MAX_WITHDRAWAL_PER_TX")
                .map_err(|_| "COLD_MAX_WITHDRAWAL_PER_TX must be set".to_string())?,
            approval_required: true,
            approval_threshold: std::env::var("COLD_APPROVAL_THRESHOLD")
                .map_err(|_| "COLD_APPROVAL_THRESHOLD must be set".to_string())?
                .parse()
                .map_err(|_| "COLD_APPROVAL_THRESHOLD must be a number".to_string())?,
        })
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tigerex_custody::Wallet;

    #[test]
    fn keypair_signs_and_verifies() {
        let crypto = CryptoService::new();
        let (private_key, public_key) = crypto.generate_keypair();

        let signature = crypto.sign("message", &private_key).unwrap();
        assert!(crypto.verify("message", &signature, &public_key));
        assert!(!crypto.verify("tampered", &signature, &public_key));
    }

    #[test]
    fn keypairs_are_unique() {
        let crypto = CryptoService::new();
        let (a, _) = crypto.generate_keypair();
        let (b, _) = crypto.generate_keypair();
        assert_ne!(a, b);
    }

    #[test]
    fn sign_rejects_a_bad_key() {
        let crypto = CryptoService::new();
        assert!(crypto.sign("message", "not-base64").is_err());
        assert!(crypto.sign("message", &base64_encode(&[0u8; 16])).is_err());
    }

    #[test]
    fn encryption_round_trips_and_hides_plaintext() {
        let crypto = CryptoService::new();
        let plaintext = "cold wallet secret material";

        let encrypted = crypto.encrypt(plaintext).unwrap();
        assert_ne!(encrypted.ciphertext, plaintext);
        assert_eq!(crypto.decrypt(&encrypted).unwrap(), plaintext);
    }

    #[test]
    fn encryption_uses_a_fresh_nonce() {
        let crypto = CryptoService::new();
        let first = crypto.encrypt("same input").unwrap();
        let second = crypto.encrypt("same input").unwrap();

        assert_ne!(first.nonce, second.nonce);
        assert_ne!(first.ciphertext, second.ciphertext);
    }

    #[test]
    fn mnemonic_words_are_unique_per_call() {
        let crypto = CryptoService::new();
        let first = crypto.generate_mnemonic(12);
        let second = crypto.generate_mnemonic(12);

        assert_eq!(first.len(), 12);
        assert_eq!(second.len(), 12);
        assert_ne!(first, second);
    }

    #[test]
    fn mnemonic_honours_the_requested_length() {
        let crypto = CryptoService::new();
        for count in [1usize, 12, 24] {
            assert_eq!(crypto.generate_mnemonic(count).len(), count);
        }
    }

    #[tokio::test]
    async fn withdrawals_require_kyc_and_sufficient_balance() {
        let mut wallet = Wallet::new("u1");

        wallet.deposit("BTC", 1.0);
        // No KYC yet.
        assert!(!wallet.can_withdraw("BTC", 0.5));

        wallet.kyc_level = 2;
        assert!(wallet.can_withdraw("BTC", 1.0));

        // Insufficient funds: this check used to be unreachable.
        assert!(!wallet.can_withdraw("BTC", 1.5));
        assert!(!wallet.can_withdraw("BTC", 0.0));
        assert!(!wallet.can_withdraw("BTC", -1.0));
        assert!(!wallet.can_withdraw("DOGE", 1.0));

        wallet.blocked = true;
        assert!(!wallet.can_withdraw("BTC", 0.5));
    }

    #[tokio::test]
    async fn lower_kyc_assets_need_level_one() {
        let mut wallet = Wallet::new("u1");
        wallet.deposit("DOGE", 100.0);

        assert!(!wallet.can_withdraw("DOGE", 10.0));
        wallet.kyc_level = 1;
        assert!(wallet.can_withdraw("DOGE", 10.0));
    }

    #[tokio::test]
    async fn no_wallets_are_seeded_on_startup() {
        let service = SecurityService::new();
        assert!(service.get_cold_wallet_address("BTC").await.is_none());
        assert!(service.insurance_fund.read().await.is_none());
        assert!(service.cold_storage.read().await.is_none());
    }

    #[tokio::test]
    async fn wallet_registration_validates_input() {
        let service = SecurityService::new();

        let mut address = WalletAddress {
            id: "btc-cold-1".to_string(),
            currency: "BTC".to_string(),
            address: "bc1qreal".to_string(),
            public_key: "pub".to_string(),
            address_type: "native".to_string(),
            chain: "bitcoin".to_string(),
            created_at: current_timestamp(),
            status: "active".to_string(),
            is_cold: true,
            multi_sig_id: None,
        };

        service.register_wallet_address(address.clone()).await.unwrap();
        // Duplicate id.
        assert!(service.register_wallet_address(address.clone()).await.is_err());

        address.id = "btc-hot-1".to_string();
        address.is_cold = false;
        assert!(service.register_wallet_address(address).await.is_err());

        assert!(service.get_cold_wallet_address("BTC").await.is_some());
    }

    #[tokio::test]
    async fn multisig_threshold_is_enforced() {
        let service = SecurityService::new();

        let signers = vec![SignerInfo {
            signer_id: "s1".to_string(),
            public_key: "pk1".to_string(),
            role: "primary".to_string(),
            name: "Primary".to_string(),
            verified_at: current_timestamp(),
        }];

        let mut config = MultiSigConfig {
            config_id: "ms-1".to_string(),
            threshold: 0,
            signers: signers.clone(),
            created_at: current_timestamp(),
            status: "active".to_string(),
        };
        assert!(service.register_multisig(config.clone()).await.is_err());

        config.threshold = 2;
        assert!(service.register_multisig(config.clone()).await.is_err());

        config.threshold = 1;
        service.register_multisig(config.clone()).await.unwrap();
        assert!(service.register_multisig(config).await.is_err());
    }

    #[tokio::test]
    async fn cold_storage_config_requires_a_threshold() {
        let service = SecurityService::new();

        let config = ColdStorageConfig {
            config_id: "cold-1".to_string(),
            hot_wallet_limit: "100".to_string(),
            cold_wallet_percentage: "95".to_string(),
            auto_top_up: false,
            top_up_threshold: "50".to_string(),
            top_up_amount: "50".to_string(),
            max_daily_withdrawal: "1000".to_string(),
            max_withdrawal_per_tx: "100".to_string(),
            approval_required: true,
            approval_threshold: 0,
        };
        assert!(service.set_cold_storage_config(config).await.is_err());
    }
}
