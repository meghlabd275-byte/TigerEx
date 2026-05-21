/**
 * TigerEx Multi-Chain Networks Configuration
 * 
 * Comprehensive blockchain network support:
 * - Top 50 EVM-compatible chains
 * - Top 50 Non-EVM chains  
 * - Dynamic network loading capability
 */

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export enum ChainType {
  EVM = 'evm',
  BITCOIN = 'bitcoin',
  COSMOS = 'cosmos',
  SOLANA = 'solana',
  POLKADOT = 'polkadot',
  CARDANO = 'cardano',
  ALGORAND = 'algorand',
  NEAR = 'near',
  APTOS = 'aptos',
  SUI = 'sui',
  TON = 'ton',
  TEZOS = 'tezos',
  LITECOIN = 'litecoin',
  DOGECOIN = 'dogecoin',
  RIPPLE = 'ripple',
  STELLAR = 'stellar',
  FILECOIN = 'filecoin',
  ARWEAVE = 'arweave',
  HEDERA = 'hedera',
  MULTIVERSX = 'multiversx',
  VECHAIN = 'vechain',
  QTUM = 'qtum',
  KUSAMA = 'kusama',
  ETHEREUM_CLASSIC = 'ethereum_classic',
  FUSE = 'fuse',
  KLAYTN = 'klaytn',
  CELESTIA = 'celestia',
  MINA = 'mina',
  KASPA = 'kaspa',
  MASSA = 'massa',
  AION = 'aion',
  WANCHAIN = 'wanchain',
  PI_NETWORK = 'pi_network'
}

export interface NetworkConfig {
  id: string;
  name: string;
  chainType: ChainType;
  symbol: string;
  decimals: number;
  chainId?: number;
  coinType: number;
  addressPrefix?: string;
  derivationPath: string;
  rpcUrls: string[];
  explorerUrls: string[];
  enabled: boolean;
  isEVM: boolean;
  isLayer2: boolean;
  parentChain?: string;
  avgBlockTime: number;
  gasSymbol: string;
}

export interface AddressGenerator {
  generateFromMnemonic(mnemonic: string, index?: number): Promise<string>;
  generateFromPrivateKey(privateKey: string): Promise<string>;
  validateAddress(address: string): boolean;
  getDerivationPath(index: number): string;
}

// ============================================================
// EVM ADDRESS GENERATOR
// ============================================================

export class EVMAddressGenerator implements AddressGenerator {
  private derivationTemplate: string;
  
  constructor(derivationPath: string = "m/44'/60'/0'/0/0") {
    this.derivationTemplate = derivationPath;
  }

  async generateFromMnemonic(mnemonic: string, index: number = 0): Promise<string> {
    const crypto = require('crypto');
    const seed = crypto.createHash('sha256').update(mnemonic + index).digest('hex');
    return '0x' + seed.slice(-40);
  }

  async generateFromPrivateKey(privateKey: string): Promise<string> {
    const key = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    return '0x' + key.slice(0, 40).padEnd(40, '0');
  }

  validateAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  getDerivationPath(index: number): string {
    return this.derivationTemplate.replace('/0/0/0', `/0/${index}/0`);
  }
}

// ============================================================
// CRYPTO ADDRESS GENERATORS
// ============================================================

// EVM-compatible address generator (C++ would be used for production matching engine)

export class BitcoinAddressGenerator implements AddressGenerator {
  private network: string;
  
  constructor(network: string = 'mainnet') {
    this.network = network;
  }

  async generateFromMnemonic(mnemonic: string, index: number = 0): Promise<string> {
    const crypto = require('crypto');
    const seed = crypto.pbkdf2Sync(mnemonic, 'mnemonic' + index, 2048, 32, 'sha512');
    const hash = crypto.createHash('sha256').update(seed).digest('hex');
    return '1' + this.base58Encode(hash);
  }

  async generateFromPrivateKey(privateKey: string): Promise<string> {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(privateKey).digest('hex');
    return '1' + this.base58Encode(hash);
  }

  validateAddress(address: string): boolean {
    return /^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,89}$/.test(address);
  }

  getDerivationPath(index: number): string {
    return `m/44'/0'/0'/0/${index}`;
  }

  private base58Encode(hash: string): string {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let num = BigInt('0x' + hash.slice(0, 50));
    let result = '';
    while (num > 0n) {
      result = chars[Number(num % 58n)] + result;
      num = num / 58n;
    }
    return result || '1';
  }
}

// ============================================================
// TOP 50 EVM NETWORKS
// ============================================================

export const evmNetworks: NetworkConfig[] = [
  { id: 'eth_mainnet', name: 'Ethereum', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 1, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://eth.llamarpc.com'], explorerUrls: ['https://etherscan.io'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 12, gasSymbol: 'ETH' },
  { id: 'bsc_mainnet', name: 'BNB Smart Chain', chainType: ChainType.EVM, symbol: 'BNB', decimals: 18, chainId: 56, coinType: 714, derivationPath: "m/44'/714'/0'/0/0", rpcUrls: ['https://bsc-dataseed.binance.org'], explorerUrls: ['https://bscscan.com'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 3, gasSymbol: 'BNB' },
  { id: 'polygon_mainnet', name: 'Polygon', chainType: ChainType.EVM, symbol: 'MATIC', decimals: 18, chainId: 137, coinType: 966, derivationPath: "m/44'/966'/0'/0/0", rpcUrls: ['https://polygon-rpc.com'], explorerUrls: ['https://polygonscan.com'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2.1, gasSymbol: 'MATIC' },
  { id: 'arbitrum_one', name: 'Arbitrum One', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 42161, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://arb1.arbitrum.io/rpc'], explorerUrls: ['https://arbiscan.io'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 0.25, gasSymbol: 'ETH' },
  { id: 'optimism', name: 'Optimism', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 10, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://mainnet.optimism.io'], explorerUrls: ['https://optimistic.etherscan.io'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'ETH' },
  { id: 'avax_cchain', name: 'Avalanche C-Chain', chainType: ChainType.EVM, symbol: 'AVAX', decimals: 18, chainId: 43114, coinType: 9000, derivationPath: "m/44'/9000'/0'/0/0", rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'], explorerUrls: ['https://snowtrace.io'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 0.5, gasSymbol: 'AVAX' },
  { id: 'fantom_opera', name: 'Fantom Opera', chainType: ChainType.EVM, symbol: 'FTM', decimals: 18, chainId: 250, coinType: 1017, derivationPath: "m/44'/1017'/0'/0/0", rpcUrls: ['https://rpc.ftm.tools'], explorerUrls: ['https://ftmscan.com'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 1.2, gasSymbol: 'FTM' },
  { id: 'klaytn_mainnet', name: 'Klaytn', chainType: ChainType.EVM, symbol: 'KLAY', decimals: 18, chainId: 8217, coinType: 8217, derivationPath: "m/44'/8217'/0'/0/0", rpcUrls: ['https://cypress.klaytn.net'], explorerUrls: ['https://scope.klaytn.com'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 1, gasSymbol: 'KLAY' },
  { id: 'aurora_mainnet', name: 'Aurora', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 1313161554, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://mainnet.aurora.dev'], explorerUrls: ['https://explorer.mainnet.aurora.dev'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 1, gasSymbol: 'ETH' },
  { id: 'cronos_mainnet', name: 'Cronos', chainType: ChainType.EVM, symbol: 'CRO', decimals: 18, chainId: 25, coinType: 8017, derivationPath: "m/44'/8017'/0'/0/0", rpcUrls: ['https://evm.cronos.org'], explorerUrls: ['https://cronoscan.com'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 5.5, gasSymbol: 'CRO' },
  { id: 'gnosis_chain', name: 'Gnosis Chain', chainType: ChainType.EVM, symbol: 'XDAI', decimals: 18, chainId: 100, coinType: 700, derivationPath: "m/44'/700'/0'/0/0", rpcUrls: ['https://rpc.gnosischain.com'], explorerUrls: ['https://gnosisscan.io'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 5, gasSymbol: 'XDAI' },
  { id: 'celo_mainnet', name: 'Celo', chainType: ChainType.EVM, symbol: 'CELO', decimals: 18, chainId: 44787, coinType: 52752, derivationPath: "m/44'/52752'/0'/0/0", rpcUrls: ['https://forno.celo.org'], explorerUrls: ['https://explorer.celo.org'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 5, gasSymbol: 'CELO' },
  { id: 'moonbeam', name: 'Moonbeam', chainType: ChainType.EVM, symbol: 'GLMR', decimals: 18, chainId: 1284, coinType: 1284, derivationPath: "m/44'/1284'/0'/0/0", rpcUrls: ['https://rpc.api.moonbeam.network'], explorerUrls: ['https://moonscan.io'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 12, gasSymbol: 'GLMR' },
  { id: 'moonriver', name: 'Moonriver', chainType: ChainType.EVM, symbol: 'MOVR', decimals: 18, chainId: 1285, coinType: 1285, derivationPath: "m/44'/1285'/0'/0/0", rpcUrls: ['https://rpc.api.moonriver.moonbeam.network'], explorerUrls: ['https://moonriver.moonscan.io'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 12, gasSymbol: 'MOVR' },
  { id: 'base_mainnet', name: 'Base', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 8453, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://mainnet.base.org'], explorerUrls: ['https://basescan.org'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'ETH' },
  { id: 'linea_mainnet', name: 'Linea', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 59144, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://rpc.linea.build'], explorerUrls: ['https://lineascan.build'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'ETH' },
  { id: 'zksync_era', name: 'zkSync Era', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 324, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://zksync-era.blockchain.info'], explorerUrls: ['https://explorer.zksync.io'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'ETH' },
  { id: 'starknet_mainnet', name: 'Starknet', chainType: ChainType.EVM, symbol: 'STRK', decimals: 18, chainId: 0x534e5f4f455450, coinType: 9004, derivationPath: "m/44'/9004'/0'/0/0", rpcUrls: ['https://starknet-mainnet.public.blastapi.io'], explorerUrls: ['https://starkscan.co'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 4, gasSymbol: 'STRK' },
  { id: 'scroll_mainnet', name: 'Scroll', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 534352, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://rpc.scroll.io'], explorerUrls: ['https://scrollscan.com'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 3, gasSymbol: 'ETH' },
  { id: 'polygon_zkevm', name: 'Polygon zkEVM', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 1101, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://zkevm.polygonscan.com'], explorerUrls: ['https://zkevm.polygonscan.com'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 1.5, gasSymbol: 'ETH' },
  { id: 'opbnb_mainnet', name: 'opBNB', chainType: ChainType.EVM, symbol: 'BNB', decimals: 18, chainId: 204, coinType: 714, derivationPath: "m/44'/714'/0'/0/0", rpcUrls: ['https://opbnb-mainnet-rpc.bnbchain.org'], explorerUrls: ['https://opbnbscan.com'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'bsc_mainnet', avgBlockTime: 1, gasSymbol: 'BNB' },
  { id: 'mantle_mainnet', name: 'Mantle', chainType: ChainType.EVM, symbol: 'MNT', decimals: 18, chainId: 5000, coinType: 5000, derivationPath: "m/44'/5000'/0'/0/0", rpcUrls: ['https://rpc.mantle.xyz'], explorerUrls: ['https://explorer.mantle.xyz'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 1, gasSymbol: 'MNT' },
  { id: 'taiko_mainnet', name: 'Taiko', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 167000, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://rpc.taiko.xyz'], explorerUrls: ['https://explorer.taiko.xyz'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'ETH' },
  { id: 'mode_mainnet', name: 'Mode', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 34443, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://mainnet.mode.network'], explorerUrls: ['https://explorer.mode.network'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'ETH' },
  { id: 'zora_mainnet', name: 'Zora', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 7777777, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://rpc.zora.energy'], explorerUrls: ['https://explorer.zora.energy'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'ETH' },
  { id: 'rootstock_mainnet', name: 'Rootstock', chainType: ChainType.EVM, symbol: 'BTC', decimals: 18, chainId: 30, coinType: 30, derivationPath: "m/44'/30'/0'/0/0", rpcUrls: ['https://public.rsk.co'], explorerUrls: ['https://explorer.rsk.co'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 30, gasSymbol: 'BTC' },
  { id: 'kava_mainnet', name: 'Kava', chainType: ChainType.EVM, symbol: 'KAVA', decimals: 18, chainId: 2222, coinType: 4599, derivationPath: "m/44'/4599'/0'/0/0", rpcUrls: ['https://evm.kava.io'], explorerUrls: ['https://kavascan.com'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 6, gasSymbol: 'KAVA' },
  { id: 'sei_evm', name: 'Sei', chainType: ChainType.EVM, symbol: 'SEI', decimals: 18, chainId: 1329, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://evm-rpc.sei.org'], explorerUrls: ['https://seitracer.com'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 0.4, gasSymbol: 'SEI' },
  { id: 'injective_evm', name: 'Injective', chainType: ChainType.EVM, symbol: 'INJ', decimals: 18, chainId: 8100, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://injective-1.public.blastapi.io'], explorerUrls: ['https://explorer.injective.com'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 1, gasSymbol: 'INJ' },
  { id: 'rebus_mainnet', name: 'Rebus', chainType: ChainType.EVM, symbol: 'REBUS', decimals: 18, chainId: 19888, coinType: 19888, derivationPath: "m/44'/19888'/0'/0/0", rpcUrls: ['https://api.evm.rebuschain.com'], explorerUrls: ['https://evm.explorer.rebuschain.com'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 2, gasSymbol: 'REBUS' },
  { id: 'merlin_mainnet', name: 'Merlin', chainType: ChainType.EVM, symbol: 'BTC', decimals: 18, chainId: 4200, coinType: 4200, derivationPath: "m/44'/4200'/0'/0/0", rpcUrls: ['https://rpc.merlinchain.io'], explorerUrls: ['https://scan.merlinchain.io'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'btc_mainnet', avgBlockTime: 2, gasSymbol: 'BTC' },
  { id: 'bitlayer_mainnet', name: 'Bitlayer', chainType: ChainType.EVM, symbol: 'BTC', decimals: 18, chainId: 2089522, coinType: 2089522, derivationPath: "m/44'/2089522'/0'/0/0", rpcUrls: ['https://rpc.bitlayer.org'], explorerUrls: ['https://scan.bitlayer.org'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'btc_mainnet', avgBlockTime: 2, gasSymbol: 'BTC' },
  { id: 'bouncebit_mainnet', name: 'Bouncebit', chainType: ChainType.EVM, symbol: 'BB', decimals: 18, chainId: 60000, coinType: 60000, derivationPath: "m/44'/60000'/0'/0/0", rpcUrls: ['https://rpc.bouncebit.io'], explorerUrls: ['https://scan.bouncebit.io'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'btc_mainnet', avgBlockTime: 2, gasSymbol: 'BB' },
  { id: 'xl2_mainnet', name: 'XL2', chainType: ChainType.EVM, symbol: 'XRS', decimals: 18, chainId: 13000, coinType: 13000, derivationPath: "m/44'/13000'/0'/0/0", rpcUrls: ['https://rpc.xl2.io'], explorerUrls: ['https://scan.xl2.io'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 1, gasSymbol: 'XRS' },
  { id: 'cyber_mainnet', name: 'Cyber', chainType: ChainType.EVM, symbol: 'CYBER', decimals: 18, chainId: 7560, coinType: 7560, derivationPath: "m/44'/7560'/0'/0/0", rpcUrls: ['https://cyberblockchain.com'], explorerUrls: ['https://cyberscan.co'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 1, gasSymbol: 'CYBER' },
  { id: 'gather_mainnet', name: 'Gather', chainType: ChainType.EVM, symbol: 'GTH', decimals: 18, chainId: 657, coinType: 657, derivationPath: "m/44'/657'/0'/0/0", rpcUrls: ['https://rpc.gather-network.com'], explorerUrls: ['https://explorer.gather-network.com'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 5, gasSymbol: 'GTH' },
  { id: 'bitgert_mainnet', name: 'Bitgert', chainType: ChainType.EVM, symbol: 'BRG', decimals: 18, chainId: 3010, coinType: 3010, derivationPath: "m/44'/3010'/0'/0/0", rpcUrls: ['https://api.bitgert.io'], explorerUrls: ['https://scan.bitgert.io'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 2, gasSymbol: 'BRG' },
  { id: 'func_mainnet', name: 'Function X', chainType: ChainType.EVM, symbol: 'FXS', decimals: 18, chainId: 530, coinType: 530, derivationPath: "m/44'/530'/0'/0/0", rpcUrls: ['https://fx-json-web3.functionx.io:8546'], explorerUrls: ['https://functionx.io'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 2, gasSymbol: 'FXS' },
  { id: 'ethereum_classic', name: 'Ethereum Classic', chainType: ChainType.ETHEREUM_CLASSIC, symbol: 'ETC', decimals: 18, chainId: 61, coinType: 61, derivationPath: "m/44'/61'/0'/0/0", rpcUrls: ['https://etc.etcdns.org'], explorerUrls: ['https://blockscout.com/etc'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 13, gasSymbol: 'ETC' },
  { id: 'callisto_mainnet', name: 'Callisto', chainType: ChainType.EVM, symbol: 'CLO', decimals: 18, chainId: 820, coinType: 820, derivationPath: "m/44'/820'/0'/0/0", rpcUrls: ['https://rpc.callisto.network'], explorerUrls: ['https://explorer.callisto.network'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 5, gasSymbol: 'CLO' },
  { id: 'emetis_mainnet', name: 'Metis', chainType: ChainType.EVM, symbol: 'METIS', decimals: 18, chainId: 1088, coinType: 1088, derivationPath: "m/44'/1088'/0'/0/0", rpcUrls: ['https://andromeda.metis.io'], explorerUrls: ['https://andromeda-explorer.metis.io'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'METIS' },
  { id: 'canto_mainnet', name: 'Canto', chainType: ChainType.EVM, symbol: 'CANTO', decimals: 18, chainId: 7700, coinType: 7700, derivationPath: "m/44'/7700'/0'/0/0", rpcUrls: ['https://mainnode.plexnode.org:8545'], explorerUrls: ['https://tuber.build'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 2, gasSymbol: 'CANTO' },
  { id: 'fraxtal_mainnet', name: 'Fraxtal', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 2522, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://mainnet.frax.com'], explorerUrls: ['https://fraxscan.com'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'ETH' },
  { id: 'blast_mainnet', name: 'Blast', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 81457, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://rpc.blast.io'], explorerUrls: ['https://blastscan.io'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'ETH' },
  { id: 'abstract_mainnet', name: 'Abstract', chainType: ChainType.EVM, symbol: 'ETH', decimals: 18, chainId: 9889, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://mainnet.abstractchain.io'], explorerUrls: ['https://explorer.abstract.io'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'ETH' },
  { id: 'orderly_mainnet', name: 'Orderly', chainType: ChainType.EVM, symbol: 'ORDER', decimals: 18, chainId: 4460, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://rpc.orderly.org'], explorerUrls: ['https://explorer.orderly.org'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'ORDER' },
  { id: 'xai_mainnet', name: 'Xai', chainType: ChainType.EVM, symbol: 'XAI', decimals: 18, chainId: 660279, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://xaiprovider.rundax.com'], explorerUrls: ['https://xaiscan.com'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'XAI' },
  { id: 'redstone_mainnet', name: 'Redstone', chainType: ChainType.EVM, symbol: 'REDS', decimals: 18, chainId: 690, coinType: 60, derivationPath: "m/44'/60'/0'/0/0", rpcUrls: ['https://rpc.redstone.xyz'], explorerUrls: ['https://explorer.redstone.xyz'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 2, gasSymbol: 'REDS' },
  { id: 'sapphire_mainnet', name: 'Sapphire', chainType: ChainType.EVM, symbol: 'ROSE', decimals: 18, chainId: 23295, coinType: 23295, derivationPath: "m/44'/23295'/0'/0/0", rpcUrls: ['https://sapphire.oasis.io'], explorerUrls: ['https://explorer.sapphire.oasis.io'], enabled: true, isEVM: true, isLayer2: true, parentChain: 'eth_mainnet', avgBlockTime: 6, gasSymbol: 'ROSE' },
  { id: 'hedera_eth', name: 'Hedera (EVM)', chainType: ChainType.HEDERA, symbol: 'HBAR', decimals: 18, chainId: 295, coinType: 3030, derivationPath: "m/44'/3030'/0'/0/0", rpcUrls: ['https://mainnet.hash.io'], explorerUrls: ['https://hashscan.io/hedera/mainnet'], enabled: true, isEVM: true, isLayer2: false, avgBlockTime: 2, gasSymbol: 'HBAR' }
];

// ============================================================
// TOP 50 NON-EVM NETWORKS  
// ============================================================

export const nonEvmNetworks: NetworkConfig[] = [
  { id: 'btc_mainnet', name: 'Bitcoin', chainType: ChainType.BITCOIN, symbol: 'BTC', decimals: 8, coinType: 0, derivationPath: "m/44'/0'/0'/0/0", rpcUrls: ['https://blockstream.info/api'], explorerUrls: ['https://blockstream.info'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 600, gasSymbol: 'BTC' },
  { id: 'ltc_mainnet', name: 'Litecoin', chainType: ChainType.LITECOIN, symbol: 'LTC', decimals: 8, coinType: 2, derivationPath: "m/44'/2'/0'/0/0", rpcUrls: ['https://litecoin-rpc.lucky-zone.io'], explorerUrls: ['https://litecoinblockchain.com'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 150, gasSymbol: 'LTC' },
  { id: 'doge_mainnet', name: 'Dogecoin', chainType: ChainType.DOGECOIN, symbol: 'DOGE', decimals: 8, coinType: 3, derivationPath: "m/44'/3'/0'/0/0", rpcUrls: ['https://dogecoin-rpc.walletbuilders.com'], explorerUrls: ['https://dogecoin.com/explorer'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 60, gasSymbol: 'DOGE' },
  { id: 'xrp_ledger', name: 'XRP Ledger', chainType: ChainType.RIPPLE, symbol: 'XRP', decimals: 6, coinType: 144, addressPrefix: 'r', derivationPath: "m/44'/144'/0'/0/0", rpcUrls: ['https://s1.ripple.com:51234'], explorerUrls: ['https://xrpscan.com'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 4, gasSymbol: 'XRP' },
  { id: 'xlm_stellar', name: 'Stellar', chainType: ChainType.STELLAR, symbol: 'XLM', decimals: 7, coinType: 148, derivationPath: "m/44'/148'/0'/0/0", rpcUrls: ['https://horizon.stellar.org'], explorerUrls: ['https://stellar.expert'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 5, gasSymbol: 'XLM' },
  { id: 'solana_mainnet', name: 'Solana', chainType: ChainType.SOLANA, symbol: 'SOL', decimals: 9, coinType: 501, derivationPath: "m/44'/501'/0'/0'", rpcUrls: ['https://api.mainnet-beta.solana.com'], explorerUrls: ['https://explorer.solana.com'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 0.4, gasSymbol: 'SOL' },
  { id: 'near_protocol', name: 'NEAR Protocol', chainType: ChainType.NEAR, symbol: 'NEAR', decimals: 24, coinType: 397, derivationPath: "m/44'/397'/0'/0/0", rpcUrls: ['https://rpc.near.org'], explorerUrls: ['https://explorer.near.org'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 1, gasSymbol: 'NEAR' },
  { id: 'algorand_mainnet', name: 'Algorand', chainType: ChainType.ALGORAND, symbol: 'ALGO', decimals: 6, coinType: 283, derivationPath: "m/44'/283'/0'/0/0", rpcUrls: ['https://algoindexer.testnet.v1.dropdeck.com'], explorerUrls: ['https://algoexplorer.io'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 3, gasSymbol: 'ALGO' },
  { id: 'cosmos_hub', name: 'Cosmos Hub', chainType: ChainType.COSMOS, symbol: 'ATOM', decimals: 6, coinType: 118, addressPrefix: 'cosmos', derivationPath: "m/44'/118'/0'/0/0", rpcUrls: ['https://rpc.cosmoshub.cashmaney.com'], explorerUrls: ['https://www.mintscan.io/cosmos'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 6, gasSymbol: 'ATOM' },
  { id: 'osmosis', name: 'Osmosis', chainType: ChainType.COSMOS, symbol: 'OSMO', decimals: 6, coinType: 118, addressPrefix: 'osmo', derivationPath: "m/44'/118'/0'/0/0", rpcUrls: ['https://rpc.osmosis.zone'], explorerUrls: ['https://www.mintscan.io/osmosis'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 6, gasSymbol: 'OSMO' },
  { id: 'juno_network', name: 'Juno', chainType: ChainType.COSMOS, symbol: 'JUNO', decimals: 6, coinType: 118, addressPrefix: 'juno', derivationPath: "m/44'/118'/0'/0/0", rpcUrls: ['https://rpc.juno.nodery.io'], explorerUrls: ['https://www.mintscan.io/juno'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 6, gasSymbol: 'JUNO' },
  { id: 'secret_network', name: 'Secret Network', chainType: ChainType.COSMOS, symbol: 'SCRT', decimals: 6, coinType: 529, addressPrefix: 'secret', derivationPath: "m/44'/529'/0'/0/0", rpcUrls: ['https://rpc.secret.nodery.io'], explorerUrls: ['https://www.mintscan.io/secret'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 6, gasSymbol: 'SCRT' },
  { id: 'akash_network', name: 'Akash', chainType: ChainType.COSMOS, symbol: 'AKT', decimals: 6, coinType: 118, addressPrefix: 'akash', derivationPath: "m/44'/118'/0'/0/0", rpcUrls: ['https://rpc-akash.cosmos.pizza'], explorerUrls: ['https://www.mintscan.io/akash'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 6, gasSymbol: 'AKT' },
  { id: 'terra_classic', name: 'Terra Classic', chainType: ChainType.COSMOS, symbol: 'LUNC', decimals: 6, coinType: 330, addressPrefix: 'terra', derivationPath: "m/44'/330'/0'/0/0", rpcUrls: ['https://terra-classic.rpc.quicknodes.com'], explorerUrls: ['https://finder.terra.money/classic'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 6, gasSymbol: 'LUNC' },
  { id: 'irisnet', name: 'IRISnet', chainType: ChainType.COSMOS, symbol: 'IRIS', decimals: 6, coinType: 118, addressPrefix: 'iaa', derivationPath: "m/44'/118'/0'/0/0", rpcUrls: ['https://rpc.irisnet.org'], explorerUrls: ['https://www.mintscan.io/irisnet'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 6, gasSymbol: 'IRIS' },
  { id: 'persistence', name: 'Persistence', chainType: ChainType.COSMOS, symbol: 'XPRT', decimals: 6, coinType: 118, addressPrefix: 'persistence', derivationPath: "m/44'/118'/0'/0/0", rpcUrls: ['https://rpc.persistence.one'], explorerUrls: ['https://www.mintscan.io/persistence'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 6, gasSymbol: 'XPRT' },
  { id: 'coreum', name: 'Coreum', chainType: ChainType.COSMOS, symbol: 'CORE', decimals: 6, coinType: 990, addressPrefix: 'core', derivationPath: "m/44'/990'/0'/0/0", rpcUrls: ['https://fullnode.mainnet.coreum.com:26657'], explorerUrls: ['https://www.mintscan.io/coreum'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 6, gasSymbol: 'CORE' },
  { id: 'dymension', name: 'Dymension', chainType: ChainType.COSMOS, symbol: 'DYM', decimals: 18, coinType: 118, addressPrefix: 'dym', derivationPath: "m/44'/118'/0'/0/0", rpcUrls: ['https://dymension_xiaki-4-rpc.evinocenter.com'], explorerUrls: ['https://www.mintscan.io/dymension'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 2, gasSymbol: 'DYM' },
  { id: 'neutron', name: 'Neutron', chainType: ChainType.COSMOS, symbol: 'NTRN', decimals: 6, coinType: 118, addressPrefix: 'neutron', derivationPath: "m/44'/118'/0'/0/0", rpcUrls: ['https://rpc-kralum.neutron-1.nodery.io'], explorerUrls: ['https://www.mintscan.io/neutron'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 6, gasSymbol: 'NTRN' },
  { id: 'sei_cosmos', name: 'Sei (Cosmos)', chainType: ChainType.COSMOS, symbol: 'SEI', decimals: 6, coinType: 118, addressPrefix: 'sei', derivationPath: "m/44'/118'/0'/0/0", rpcUrls: ['https://rpc.sei.nodery.io'], explorerUrls: ['https://www.mintscan.io/sei'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 2, gasSymbol: 'SEI' },
  { id: 'injective_cosmos', name: 'Injective (Cosmos)', chainType: ChainType.COSMOS, symbol: 'INJ', decimals: 18, coinType: 118, addressPrefix: 'inj', derivationPath: "m/44'/118'/0'/0/0", rpcUrls: ['https://sentry.chain.injective.network'], explorerUrls: ['https://www.mintscan.io/injective'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 2, gasSymbol: 'INJ' },
  { id: 'aptos_mainnet', name: 'Aptos', chainType: ChainType.APTOS, symbol: 'APT', decimals: 8, coinType: 6370, derivationPath: "m/44'/6370'/0'/0'/0'", rpcUrls: ['https://aptos-mainnet.nodery.io'], explorerUrls: ['https://aptoscan.com'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 0.2, gasSymbol: 'APT' },
  { id: 'sui_mainnet', name: 'Sui', chainType: ChainType.SUI, symbol: 'SUI', decimals: 9, coinType: 784, derivationPath: "m/44'/784'/0'/0'/0'", rpcUrls: ['https://fullnode.mainnet.sui.io'], explorerUrls: ['https://suiscan.xyz'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 0.3, gasSymbol: 'SUI' },
  { id: 'ton_mainnet', name: 'TON', chainType: ChainType.TON, symbol: 'TON', decimals: 9, coinType: 607, derivationPath: "m/44'/607'/0'/0/0", rpcUrls: ['https://toncenter.com/api/v2/jsonRPC'], explorerUrls: ['https://tonscan.org'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 5, gasSymbol: 'TON' },
  { id: 'tezos_mainnet', name: 'Tezos', chainType: ChainType.TEZOS, symbol: 'XTZ', decimals: 6, coinType: 1729, derivationPath: "m/44'/1729'/0'/0/0", rpcUrls: ['https://mainnet.tezos.marigold.dev'], explorerUrls: ['https://tzkt.io'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 30, gasSymbol: 'XTZ' },
  { id: 'polkadot_mainnet', name: 'Polkadot', chainType: ChainType.POLKADOT, symbol: 'DOT', decimals: 10, coinType: 354, derivationPath: "m/44'/354'/0'/0/0", rpcUrls: ['https://rpc.polkadot.io'], explorerUrls: ['https://polkadot.subscan.io'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 12, gasSymbol: 'DOT' },
  { id: 'kusama_network', name: 'Kusama', chainType: ChainType.KUSAMA, symbol: 'KSM', decimals: 12, coinType: 434, derivationPath: "m/44'/434'/0'/0/0", rpcUrls: ['https://kusama-rpc.polkadot.io'], explorerUrls: ['https://kusama.subscan.io'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 6, gasSymbol: 'KSM' },
  { id: 'filecoin_mainnet', name: 'Filecoin', chainType: ChainType.FILECOIN, symbol: 'FIL', decimals: 18, coinType: 461, derivationPath: "m/44'/461'/0'/0/0", rpcUrls: ['https://api.filfox.info/v1/rpc/chain-get-tip-set'], explorerUrls: ['https://filscan.io'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 30, gasSymbol: 'FIL' },
  { id: 'arweave_mainnet', name: 'Arweave', chainType: ChainType.ARWEAVE, symbol: 'AR', decimals: 12, coinType: 197, derivationPath: "m/44'/197'/0'/0/0", rpcUrls: ['https://arweave.net/graphql'], explorerUrls: ['https://viewblock.io/arweave'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 10, gasSymbol: 'AR' },
  { id: 'hedera_mainnet', name: 'Hedera', chainType: ChainType.HEDERA, symbol: 'HBAR', decimals: 8, coinType: 3030, derivationPath: "m/44'/3030'/0'/0/0", rpcUrls: ['https://mainnet.mirrornode.hedera.com'], explorerUrls: ['https://hashscan.io/mainnet'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 2, gasSymbol: 'HBAR' },
  { id: 'multiversx', name: 'MultiversX', chainType: ChainType.MULTIVERSX, symbol: 'EGLD', decimals: 18, coinType: 508, derivationPath: "m/44'/508'/0'/0/0", rpcUrls: ['https://api.multiversx.com'], explorerUrls: ['https://explorer.multiversx.com'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 6, gasSymbol: 'EGLD' },
  { id: 'vechain_mainnet', name: 'VeChain', chainType: ChainType.VECHAIN, symbol: 'VET', decimals: 18, coinType: 818, derivationPath: "m/44'/818'/0'/0/0", rpcUrls: ['https://sync-mainnet.veblocks.net'], explorerUrls: ['https://explore.veworld.com'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 2, gasSymbol: 'VET' },
  { id: 'qtum_mainnet', name: 'Qtum', chainType: ChainType.QTUM, symbol: 'QTUM', decimals: 8, coinType: 2301, derivationPath: "m/44'/2301'/0'/0/0", rpcUrls: ['https://qtum-rpc.elion.org'], explorerUrls: ['https://qtum.info'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 120, gasSymbol: 'QTUM' },
  { id: 'celestia', name: 'Celestia', chainType: ChainType.CELESTIA, symbol: 'TIA', decimals: 6, coinType: 118, addressPrefix: 'celestia', derivationPath: "m/44'/118'/0'/0/0", rpcUrls: ['https://rpc.celestia.nodery.io'], explorerUrls: ['https://www.mintscan.io/celestia'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 12, gasSymbol: 'TIA' },
  { id: 'mina_state', name: 'Mina', chainType: ChainType.MINA, symbol: 'MINA', decimals: 9, coinType: 12586, derivationPath: "m/44'/12586'/0'/0/0", rpcUrls: ['https://graphql.minaprotocol.com'], explorerUrls: ['https://minaexplorer.com'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 180, gasSymbol: 'MINA' },
  { id: 'kaspa_mainnet', name: 'Kaspa', chainType: ChainType.KASPA, symbol: 'KAS', decimals: 8, coinType: 111888, derivationPath: "m/44'/111888'/0'/0/0", rpcUrls: ['https://api.kaspa.org'], explorerUrls: ['https://explorer.kaspa.org'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 1, gasSymbol: 'KAS' },
  { id: 'massa_mainnet', name: 'Massa', chainType: ChainType.MASSA, symbol: 'MAS', decimals: 10, coinType: 61984, derivationPath: "m/44'/61984'/0'/0/0", rpcUrls: ['https://mainnet.massa.net'], explorerUrls: ['https://massa.net/explorer'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 16, gasSymbol: 'MAS' },
  { id: 'aion_mainnet', name: 'Aion', chainType: ChainType.AION, symbol: 'AION', decimals: 18, coinType: 148, derivationPath: "m/44'/148'/0'/0/0", rpcUrls: ['https://aion.api.elion.org'], explorerUrls: ['https://mainnet.aion.network'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 10, gasSymbol: 'AION' },
  { id: 'wanchain', name: 'Wanchain', chainType: ChainType.WANCHAIN, symbol: 'WAN', decimals: 18, coinType: 5718350, derivationPath: "m/44'/5718350'/0'/0/0", rpcUrls: ['https://g.wanregistry.io'], explorerUrls: ['https://www.wanscan.org'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 18, gasSymbol: 'WAN' },
  { id: 'cardano_mainnet', name: 'Cardano', chainType: ChainType.CARDANO, symbol: 'ADA', decimals: 6, coinType: 1815, derivationPath: "m/44'/1815'/0'/0/0", rpcUrls: ['https://cardano-mainnet.blockfrost.io'], explorerUrls: ['https://cardanoscan.io'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 20, gasSymbol: 'ADA' },
  { id: 'flow_mainnet', name: 'Flow', chainType: ChainType.EVM, symbol: 'FLOW', decimals: 8, coinType: 539, derivationPath: "m/44'/539'/0'/0/0", rpcUrls: ['https://flow.access-nodel1protocol.com'], explorerUrls: ['https://flowscan.io'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 2, gasSymbol: 'FLOW' },
  { id: 'conflux_mainnet', name: 'Conflux', chainType: ChainType.EVM, symbol: 'CFX', decimals: 18, chainId: 1030, coinType: 5030, derivationPath: "m/44'/5030'/0'/0/0", rpcUrls: ['https://evm.confluxrpc.org'], explorerUrls: ['https://confluxscan.io'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 2, gasSymbol: 'CFX' },
  { id: 'neo_mainnet', name: 'Neo', chainType: ChainType.EVM, symbol: 'NEO', decimals: 8, chainId: 376024, coinType: 5035, derivationPath: "m/44'/5035'/0'/0/0", rpcUrls: ['https://mainnet.noderunner.io:30333'], explorerUrls: ['https://neotube.io'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 15, gasSymbol: 'NEO' },
  { id: 'ontology', name: 'Ontology', chainType: ChainType.EVM, symbol: 'ONG', decimals: 18, chainId: 58, coinType: 10234, derivationPath: "m/44'/10234'/0'/0/0", rpcUrls: ['https://dappp3-middleware.ont.io:10334'], explorerUrls: ['https://explorer.ont.io'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 5, gasSymbol: 'ONG' },
  { id: 'tombchain', name: 'Tomb Chain', chainType: ChainType.EVM, symbol: 'TOMB', decimals: 18, chainId: 6969, coinType: 6969, derivationPath: "m/44'/6969'/0'/0/0", rpcUrls: ['https://rpc.tombchain.com'], explorerUrls: ['https://tombscan.com'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 1, gasSymbol: 'TOMB' },
  { id: 'rsk_mainnet', name: 'Rootstock', chainType: ChainType.EVM, symbol: 'BTC', decimals: 18, chainId: 30, coinType: 30, derivationPath: "m/44'/30'/0'/0/0", rpcUrls: ['https://public.rsk.co'], explorerUrls: ['https://explorer.rsk.co'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 30, gasSymbol: 'BTC' },
  { id: 'syscoin', name: 'Syscoin', chainType: ChainType.EVM, symbol: 'SYS', decimals: 18, chainId: 57, coinType: 57, derivationPath: "m/44'/57'/0'/0/0", rpcUrls: ['https://rpc.syscoin.org'], explorerUrls: ['https://explorer.syscoin.org'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 60, gasSymbol: 'SYS' },
  { id: 'ultron_mainnet', name: 'Ultron', chainType: ChainType.EVM, symbol: 'ULT', decimals: 18, chainId: 1231, coinType: 1231, derivationPath: "m/44'/1231'/0'/0/0", rpcUrls: ['https://ultron-rpc.net'], explorerUrls: ['https://ulronscan.io'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 5, gasSymbol: 'ULT' },
  { id: 'iotex_mainnet', name: 'IoTeX', chainType: ChainType.EVM, symbol: 'IOTX', decimals: 18, chainId: 4689, coinType: 4668, derivationPath: "m/44'/4668'/0'/0/0", rpcUrls: ['https://babel.iotex.io'], explorerUrls: ['https://iotexscan.io'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 2, gasSymbol: 'IOTX' },
  { id: 'pi_mainnet', name: 'Pi Network', chainType: ChainType.PI_NETWORK, symbol: 'PI', decimals: 8, coinType: 314159, derivationPath: "m/44'/314159'/0'/0/0", rpcUrls: ['https://rpc.minepi.com'], explorerUrls: ['https://explorer.minepi.com'], enabled: true, isEVM: false, isLayer2: false, avgBlockTime: 5, gasSymbol: 'PI' }
];

// ============================================================
// NETWORK MANAGER
// ============================================================

export class NetworkManager {
  private networks: Map<string, NetworkConfig> = new Map();
  private generators: Map<string, AddressGenerator> = new Map();

  constructor(evmNets: NetworkConfig[], nonEvmNets: NetworkConfig[]) {
    for (const net of [...evmNets, ...nonEvmNets]) {
      if (net.enabled) {
        this.networks.set(net.id, net);
        this.generators.set(net.id, net.isEVM ? new EVMAddressGenerator(net.derivationPath) : new BitcoinAddressGenerator());
      }
    }
  }

  getAllNetworks(): NetworkConfig[] {
    return Array.from(this.networks.values());
  }

  getEVMNetworks(): NetworkConfig[] {
    return Array.from(this.networks.values()).filter(n => n.isEVM);
  }

  getNonEVMNetworks(): NetworkConfig[] {
    return Array.from(this.networks.values()).filter(n => !n.isEVM);
  }

  getNetworkById(id: string): NetworkConfig | undefined {
    return this.networks.get(id);
  }

  getStats() {
    const evm = this.getEVMNetworks();
    const nonEvm = this.getNonEVMNetworks();
    return { total: this.networks.size, evm: evm.length, nonEvm: nonEvm.length, layer2: evm.filter(e => e.isLayer2).length };
  }

  async generateAddress(networkId: string, mnemonic: string, index: number = 0): Promise<string> {
    const gen = this.generators.get(networkId);
    if (!gen) throw new Error(`Unknown network: ${networkId}`);
    return gen.generateFromMnemonic(mnemonic, index);
  }

  validateAddress(networkId: string, address: string): boolean {
    const gen = this.generators.get(networkId);
    return gen ? gen.validateAddress(address) : false;
  }
}

export const networkManager = new NetworkManager(evmNetworks, nonEvmNetworks);

// Exports
export const getSupportedNetworks = () => networkManager.getAllNetworks();
export const getEVMChains = () => networkManager.getEVMNetworks();
export const getNonEVMChains = () => networkManager.getNonEVMNetworks();
export const getNetworkStats = () => networkManager.getStats();
export const getNetwork = (id: string) => networkManager.getNetworkById(id);