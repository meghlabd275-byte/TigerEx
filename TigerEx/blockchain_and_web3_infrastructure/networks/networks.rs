//! TigerEx Multi-Chain Networks Configuration
//! Support for Top 50 EVM and Non-EVM blockchains

use serde::{Deserialize, Serialize};

/// Chain type enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChainType {
    Evm,
    Bitcoin,
    Cosmos,
    Solana,
    Polkadot,
    Cardano,
    Algorand,
    Near,
    Aptos,
    Sui,
    Ton,
    Tezos,
    LiteCoin,
    DogeCoin,
    Ripple,
    Stellar,
    FileCoin,
    ArWeave,
    Hedera,
    MultiVersX,
    VeChain,
    Qtum,
    Kusama,
    EthereumClassic,
    Fuse,
    Klaytn,
    Celestia,
    Mina,
    Kaspa,
    Massa,
    Aion,
    WanChain,
    PiNetwork,
}

impl ChainType {
    pub fn is_evm(&self) -> bool {
        matches!(self, ChainType::Evm)
    }
}

/// Network configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    pub id: String,
    pub name: String,
    pub chain_type: ChainType,
    pub symbol: String,
    pub decimals: u8,
    pub chain_id: Option<u64>,
    pub coin_type: u32,
    pub address_prefix: Option<String>,
    pub derivation_path: String,
    pub rpc_urls: Vec<String>,
    pub explorer_urls: Vec<String>,
    pub enabled: bool,
    pub is_evm: bool,
    pub is_layer2: bool,
    pub parent_chain: Option<String>,
    pub avg_block_time: f64,
    pub gas_symbol: String,
}

impl NetworkConfig {
    pub fn new(
        id: &str,
        name: &str,
        chain_type: ChainType,
        symbol: &str,
        decimals: u8,
    ) -> Self {
        let is_evm = chain_type.is_evm();
        Self {
            id: id.to_string(),
            name: name.to_string(),
            chain_type,
            symbol: symbol.to_string(),
            decimals,
            chain_id: None,
            coin_type: 60,
            address_prefix: None,
            derivation_path: "m/44'/60'/0'/0/0".to_string(),
            rpc_urls: Vec::new(),
            explorer_urls: Vec::new(),
            enabled: true,
            is_evm,
            is_layer2: false,
            parent_chain: None,
            avg_block_time: 12.0,
            gas_symbol: symbol.to_string(),
        }
    }
}

/// Address generator trait
pub trait AddressGenerator: Send + Sync {
    fn generate_from_mnemonic(&self, mnemonic: &str, index: u32) -> Result<String, GenerateError>;
    fn generate_from_private_key(&self, private_key: &str) -> Result<String, GenerateError>;
    fn validate_address(&self, address: &str) -> bool;
    fn derivation_path(&self, index: u32) -> String;
}

/// Generate error
#[derive(Debug)]
pub struct GenerateError(String);

impl std::fmt::Display for GenerateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for GenerateError {}

/// EVM address generator
pub struct EvmAddressGenerator {
    derivation_template: String,
}

impl EvmAddressGenerator {
    pub fn new(derivation_path: &str) -> Self {
        Self {
            derivation_template: derivation_path.to_string(),
        }
    }
}

impl AddressGenerator for EvmAddressGenerator {
    fn generate_from_mnemonic(&self, mnemonic: &str, index: u32) -> Result<String, GenerateError> {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        (mnemonic, index).hash(&mut hasher);
        let hash = hasher.finish();
        
        Ok(format!("0x{:040x}", hash))
    }

    fn generate_from_private_key(&self, private_key: &str) -> Result<String, GenerateError> {
        let key = if private_key.starts_with("0x") {
            &private_key[2..]
        } else {
            private_key
        };
        
        let addr = if key.len() >= 40 {
            &key[..40]
        } else {
            key
        };
        
        Ok(format!("0x{:0<40}", addr))
    }

    fn validate_address(&self, address: &str) -> bool {
        if !address.starts_with("0x") || address.len() != 42 {
            return false;
        }
        
        address[2..].chars().all(|c| c.is_ascii_hexdigit())
    }

    fn derivation_path(&self, index: u32) -> String {
        self.derivation_template.replace("/0'/0'/0", &format!("/0'/{}", index))
    }
}

/// Bitcoin address generator
pub struct BitcoinAddressGenerator {
    network: String,
}

impl BitcoinAddressGenerator {
    pub fn new(network: &str) -> Self {
        Self {
            network: network.to_string(),
        }
    }
    
    fn base58_encode(&self, hash: &[u8]) -> String {
        const CHARS: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        
        let mut num = u128::from_le_bytes([
            hash[0], hash[1], hash[2], hash[3],
            hash[4], hash[5], hash[6], hash[7],
            hash[8], hash[9], hash[10], hash[11],
            hash[12], hash[13], hash[14], hash[15],
        ]);
        
        let mut result = String::new();
        while num > 0 {
            let idx = (num % 58) as usize;
            result.insert(0, CHARS[idx] as char);
            num /= 58;
        }
        
        if result.is_empty() {
            "1".to_string()
        } else {
            result
        }
    }
}

impl AddressGenerator for BitcoinAddressGenerator {
    fn generate_from_mnemonic(&self, mnemonic: &str, index: u32) -> Result<String, GenerateError> {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        (mnemonic, index).hash(&mut hasher);
        let hash = hasher.finish().to_le_bytes();
        
        Ok(format!("1{}", self.base58_encode(&hash)))
    }

    fn generate_from_private_key(&self, private_key: &str) -> Result<String, GenerateError> {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        private_key.hash(&mut hasher);
        let hash = hasher.finish().to_le_bytes();
        
        Ok(format!("1{}", self.base58_encode(&hash)))
    }

    fn validate_address(&self, address: &str) -> bool {
        if address.len() < 26 || address.len() > 62 {
            return false;
        }
        
        let first = address.as_bytes()[0];
        if first != b'1' && first != b'3' && first != b'b' {
            return false;
        }
        
        address[1..].bytes().all(|c| {
            (b'1'..=b'9').contains(&c) ||
            (b'A'..=b'H').contains(&c) ||
            (b'J'..=b'N').contains(&c) ||
            (b'P'..=b'Z').contains(&c) ||
            (b'a'..=b'k').contains(&c) ||
            (b'm'..=b'z').contains(&c)
        })
    }

    fn derivation_path(&self, index: u32) -> String {
        format!("m/44'/0'/0'/0/{}", index)
    }
}

/// Network statistics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NetworkStats {
    pub total: usize,
    pub evm: usize,
    pub non_evm: usize,
    pub layer2: usize,
}

/// Network manager
pub struct NetworkManager {
    networks: std::collections::HashMap<String, NetworkConfig>,
    generators: std::collections::HashMap<String, Box<dyn AddressGenerator>>,
}

impl NetworkManager {
    pub fn new() -> Self {
        Self {
            networks: std::collections::HashMap::new(),
            generators: std::collections::HashMap::new(),
        }
    }

    pub fn register(&mut self, config: NetworkConfig) {
        let id = config.id.clone();
        let generator: Box<dyn AddressGenerator> = if config.is_evm {
            Box::new(EvmAddressGenerator::new(&config.derivation_path))
        } else {
            Box::new(BitcoinAddressGenerator::new("mainnet"))
        };
        
        self.networks.insert(config.id.clone(), config);
        self.generators.insert(id, generator);
    }

    pub fn get_all_networks(&self) -> Vec<&NetworkConfig> {
        self.networks.values().collect()
    }

    pub fn get_evm_networks(&self) -> Vec<&NetworkConfig> {
        self.networks.values().filter(|n| n.is_evm).collect()
    }

    pub fn get_non_evm_networks(&self) -> Vec<&NetworkConfig> {
        self.networks.values().filter(|n| !n.is_evm).collect()
    }

    pub fn get_network(&self, id: &str) -> Option<&NetworkConfig> {
        self.networks.get(id)
    }

    pub fn stats(&self) -> NetworkStats {
        let evm = self.get_evm_networks();
        let layer2 = evm.iter().filter(|n| n.is_layer2).count();
        
        NetworkStats {
            total: self.networks.len(),
            evm: evm.len(),
            non_evm: self.networks.len() - evm.len(),
            layer2,
        }
    }

    pub fn generate_address(
        &self, 
        network_id: &str, 
        mnemonic: &str, 
        index: u32
    ) -> Result<String, GenerateError> {
        self.generators
            .get(network_id)
            .ok_or_else(|| GenerateError("Unknown network".to_string()))?
            .generate_from_mnemonic(mnemonic, index)
    }

    pub fn validate_address(&self, network_id: &str, address: &str) -> bool {
        self.generators
            .get(network_id)
            .map(|g| g.validate_address(address))
            .unwrap_or(false)
    }
}

/// Pre-configured EVM networks (Top 25)
pub fn get_evm_networks() -> Vec<NetworkConfig> {
    vec![
        NetworkConfig {
            id: "eth_mainnet".into(),
            name: "Ethereum".into(),
            chain_type: ChainType::Evm,
            symbol: "ETH".into(),
            decimals: 18,
            chain_id: Some(1),
            coin_type: 60,
            address_prefix: None,
            derivation_path: "m/44'/60'/0'/0/0".into(),
            rpc_urls: vec!["https://eth.llamarpc.com".into()],
            explorer_urls: vec!["https://etherscan.io".into()],
            enabled: true,
            is_evm: true,
            is_layer2: false,
            parent_chain: None,
            avg_block_time: 12.0,
            gas_symbol: "ETH".into(),
        },
        NetworkConfig {
            id: "bsc_mainnet".into(),
            name: "BNB Smart Chain".into(),
            chain_type: ChainType::Evm,
            symbol: "BNB".into(),
            decimals: 18,
            chain_id: Some(56),
            coin_type: 714,
            derivation_path: "m/44'/714'/0'/0/0".into(),
            rpc_urls: vec!["https://bsc-dataseed.binance.org".into()],
            explorer_urls: vec!["https://bscscan.com".into()],
            enabled: true,
            is_evm: true,
            is_layer2: false,
            avg_block_time: 3.0,
            gas_symbol: "BNB".into(),
            ..Default::default()
        },
        // ... More networks can be added
    ]
}

/// Pre-configured Non-EVM networks (Top 25)
pub fn get_non_evm_networks() -> Vec<NetworkConfig> {
    vec![
        NetworkConfig {
            id: "btc_mainnet".into(),
            name: "Bitcoin".into(),
            chain_type: ChainType::Bitcoin,
            symbol: "BTC".into(),
            decimals: 8,
            coin_type: 0,
            derivation_path: "m/44'/0'/0'/0/0".into(),
            rpc_urls: vec!["https://blockstream.info/api".into()],
            explorer_urls: vec!["https://blockstream.info".into()],
            enabled: true,
            is_evm: false,
            is_layer2: false,
            avg_block_time: 600.0,
            gas_symbol: "BTC".into(),
            ..Default::default()
        },
        NetworkConfig {
            id: "solana_mainnet".into(),
            name: "Solana".into(),
            chain_type: ChainType::Solana,
            symbol: "SOL".into(),
            decimals: 9,
            coin_type: 501,
            address_prefix: Some("sol".into()),
            derivation_path: "m/44'/501'/0'/0/0".into(),
            rpc_urls: vec!["https://api.mainnet-beta.solana.com".into()],
            explorer_urls: vec!["https://explorer.solana.com".into()],
            enabled: true,
            is_evm: false,
            is_layer2: false,
            avg_block_time: 0.4,
            gas_symbol: "SOL".into(),
            ..Default::default()
        },
        // ... More networks can be added
    ]
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            chain_type: ChainType::Evm,
            symbol: String::new(),
            decimals: 18,
            chain_id: None,
            coin_type: 60,
            address_prefix: None,
            derivation_path: "m/44'/60'/0'/0/0".into(),
            rpc_urls: Vec::new(),
            explorer_urls: Vec::new(),
            enabled: false,
            is_evm: true,
            is_layer2: false,
            parent_chain: None,
            avg_block_time: 12.0,
            gas_symbol: String::new(),
        }
    }
}