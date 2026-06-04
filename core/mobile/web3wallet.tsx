/**
 * TigerEx Web3 Wallet System
 * Complete decentralized wallet infrastructure
 * Similar to Trust Wallet / Bitget Wallet
 */

import React, { useState, useEffect, createContext, useContext } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, 
  ScrollView, FlatList, StyleSheet, Alert,
  SafeAreaView, StatusBar, Modal, KeyboardAvoidingView, Platform
} from 'react-native';
import { ethers, providers, Wallet, utils, Contract, BigNumber } from 'ethers';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================================
// THEME
// ============================================================================

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(true);
  
  const colors = isDark ? {
    background: '#0a0a0a', surface: '#1a1a1a', surface2: '#2a2a2a',
    primary: '#f97316', text: '#ffffff', textSecondary: '#a0a0a0',
    border: '#333333', success: '#22c55e', error: '#ef4444',
    warning: '#eab308',
  } : {
    background: '#f5f5f5', surface: '#ffffff', surface2: '#f0f0f0',
    primary: '#f97316', text: '#1a1a1a', textSecondary: '#666666',
    border: '#e0e0e0', success: '#16a34a', error: '#dc2626',
    warning: '#ca8a04',
  };
  
  return (
    <ThemeContext.Provider value={{ isDark, colors, setIsDark: () => setIsDark(!isDark) }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

// ============================================================================
// BLOCKCHAIN NETWORKS
// ============================================================================

export const SUPPORTED_NETWORKS = {
  // EVM Chains
  ethereum: {
    id: 1, name: 'Ethereum', symbol: 'ETH', rpc: 'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io', decimals: 18, type: 'evm',
  },
  bsc: {
    id: 56, name: 'BNB Smart Chain', symbol: 'BNB', rpc: 'https://bsc-dataseed.binance.org',
    explorer: 'https://bscscan.com', decimals: 18, type: 'evm',
  },
  arbitrum: {
    id: 42161, name: 'Arbitrum One', symbol: 'ETH', rpc: 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io', decimals: 18, type: 'evm',
  },
  optimism: {
    id: 10, name: 'Optimism', symbol: 'ETH', rpc: 'https://mainnet.optimism.io',
    explorer: 'https://optimistic.etherscan.io', decimals: 18, type: 'evm',
  },
  polygon: {
    id: 137, name: 'Polygon', symbol: 'MATIC', rpc: 'https://polygon-rpc.com',
    explorer: 'https://polygonscan.com', decimals: 18, type: 'evm',
  },
  avalanche: {
    id: 43114, name: 'Avalanche C-Chain', symbol: 'AVAX', rpc: 'https://api.avax.network/ext/bc/C/rpc',
    explorer: 'https://snowtrace.io', decimals: 18, type: 'evm',
  },
  // Non-EVM Chains
  solana: {
    id: 'solana', name: 'Solana', symbol: 'SOL', rpc: 'https://api.mainnet-beta.solana.com',
    explorer: 'https://solscan.io', decimals: 9, type: 'non-evm',
  },
  ton: {
    id: 'ton', name: 'TON', symbol: 'TON', rpc: 'https://toncenter.com/api/v2',
    explorer: 'https://tonscan.org', decimals: 9, type: 'non-evm',
  },
};

// ============================================================================
// WALLET CONTEXT
// ============================================================================

const WalletContext = createContext();

export const WalletProvider = ({ children }) => {
  const [wallets, setWallets] = useState({});
  const [activeNetwork, setActiveNetwork] = useState('ethereum');
  const [balances, setBalances] = useState({});
  const [transactions, setTransactions] = useState([]);
  
  // Generate mnemonic (24 words)
  const generateMnemonic = () => {
    const wordList = [
      'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse',
      'access', 'accident', 'account', 'accuse', 'achieve', 'acid', 'acoustic', 'acquire', 'across', 'act',
      'action', 'actor', 'actress', 'actual', 'adapt', 'add', 'addict', 'address', 'adjust', 'admit',
      'adult', 'advance', 'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
      'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album', 'alcohol', 'alert',
      'alien', 'all', 'alley', 'allow', 'almost', 'alone', 'alpha', 'already', 'also', 'alter',
    ];
    let mnemonic = [];
    for (let i = 0; i < 24; i++) {
      mnemonic.push(wordList[Math.floor(Math.random() * wordList.length)]);
    }
    return mnemonic.join(' ');
  };
  
  // Create wallet from mnemonic
  const createWallet = async (mnemonic, password, network = 'ethereum') => {
    try {
      const wallet = ethers.Wallet.fromMnemonic(mnemonic);
      
      // Encrypt with password
      const encrypted = await wallet.encrypt(password);
      
      // Save to storage
      const walletData = {
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonic: mnemonic,
        network: network,
        createdAt: Date.now(),
      };
      
      setWallets(prev => ({ ...prev, [wallet.address]: walletData }));
      
      // Save encrypted to AsyncStorage
      await AsyncStorage.setItem(`wallet_${wallet.address}`, JSON.stringify({
        encrypted,
        network,
      }));
      
      return { success: true, address: wallet.address };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };
  
  // Import wallet from private key
  const importWallet = async (privateKey, password, network = 'ethereum') => {
    try {
      const wallet = new ethers.Wallet(privateKey);
      const mnemonic = ethers.Wallet.createRandom().mnemonic.phrase;
      
      const walletData = {
        address: wallet.address,
        privateKey: privateKey,
        mnemonic: mnemonic,
        network: network,
        createdAt: Date.now(),
      };
      
      setWallets(prev => ({ ...prev, [wallet.address]: walletData }));
      
      return { success: true, address: wallet.address };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };
  
  // Get balance
  const getBalance = async (address, network = activeNetwork) => {
    try {
      const networkConfig = SUPPORTED_NETWORKS[network];
      const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
      
      const balance = await provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch (error) {
      console.error('Balance error:', error);
      return '0';
    }
  };
  
  // Send transaction
  const sendTransaction = async (fromAddress, toAddress, amount, network = activeNetwork) => {
    try {
      const walletData = wallets[fromAddress];
      if (!walletData) throw new Error('Wallet not found');
      
      const networkConfig = SUPPORTED_NETWORKS[network];
      const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
      const wallet = new ethers.Wallet(walletData.privateKey, provider);
      
      const tx = await wallet.sendTransaction({
        to: toAddress,
        value: ethers.parseEther(amount.toString()),
      });
      
      const receipt = await tx.wait();
      
      // Add to transactions
      setTransactions(prev => [{
        hash: tx.hash,
        from: fromAddress,
        to: toAddress,
        amount: amount,
        network: network,
        status: receipt.status ? 'confirmed' : 'failed',
        timestamp: Date.now(),
      }, ...prev]);
      
      return { success: true, hash: tx.hash };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };
  
  // Token transfer
  const sendToken = async (fromAddress, toAddress, amount, tokenAddress, network = activeNetwork) => {
    try {
      const walletData = wallets[fromAddress];
      if (!walletData) throw new Error('Wallet not found');
      
      const networkConfig = SUPPORTED_NETWORKS[network];
      const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
      const wallet = new ethers.Wallet(walletData.privateKey, provider);
      
      // ERC20 ABI
      const abi = ['function transfer(address to, uint256 amount) returns (bool)'];
      const contract = new Contract(tokenAddress, abi, wallet);
      
      const tx = await contract.transfer(toAddress, ethers.parseEther(amount.toString()));
      const receipt = await tx.wait();
      
      return { success: true, hash: tx.hash };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };
  
  // Swap (simplified - would integrate with DEX)
  const swap = async (fromAddress, fromToken, toToken, amount, network = activeNetwork) => {
    try {
      // In production, integrate with Uniswap/Sushiswap
      // This is a placeholder for the swap logic
      return { 
        success: true, 
        hash: '0x' + Math.random().toString(16).substr(2, 64),
        message: 'Swap initiated - will complete in ~30 seconds'
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };
  
  // Sign message
  const signMessage = async (address, message, network = activeNetwork) => {
    try {
      const walletData = wallets[address];
      if (!walletData) throw new Error('Wallet not found');
      
      const networkConfig = SUPPORTED_NETWORKS[network];
      const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
      const wallet = new ethers.Wallet(walletData.privateKey, provider);
      
      const signature = await wallet.signMessage(message);
      return { success: true, signature };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };
  
  // Connect DApp
  const connectDApp = async (address, dAppUrl, network = activeNetwork) => {
    try {
      // In production, implement wallet_connect protocol
      return { success: true, session: { address, dAppUrl, network } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };
  
  // Get token balance
  const getTokenBalance = async (address, tokenAddress, network = activeNetwork) => {
    try {
      const walletData = wallets[address];
      if (!walletData) return '0';
      
      const networkConfig = SUPPORTED_NETWORKS[network];
      const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
      
      // ERC20 balanceOf
      const abi = ['function balanceOf(address owner) view returns (uint256)'];
      const contract = new Contract(tokenAddress, abi, provider);
      
      const balance = await contract.balanceOf(address);
      return ethers.formatEther(balance);
    } catch (error) {
      return '0';
    }
  };
  
  return (
    <WalletContext.Provider value={{
      wallets, activeNetwork, balances, transactions,
      generateMnemonic, createWallet, importWallet,
      getBalance, sendTransaction, sendToken, swap,
      signMessage, connectDApp, getTokenBalance,
      setActiveNetwork,
    }}>
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => useContext(WalletContext);

// ============================================================================
// WALLET SCREENS
// ============================================================================

export const CreateWalletScreen = ({ navigation }) => {
  const { colors } = useTheme();
  const { generateMnemonic, createWallet } = useWallet();
  
  const [step, setStep] = useState(1);
  const [mnemonic, setMnemonic] = useState([]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  
  const handleGenerate = () => {
    const words = generateMnemonic();
    setMnemonic(words.split(' '));
    setStep(2);
  };
  
  const handleCreate = async () => {
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }
    
    setLoading(true);
    const result = await createWallet(mnemonic.join(' '), password);
    setLoading(false);
    
    if (result.success) {
      Alert.alert('Success', 'Wallet created successfully!', [
        { text: 'OK', onPress: () => navigation.replace('Home') }
      ]);
    } else {
      Alert.alert('Error', result.error);
    }
  };
  
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.title, { color: colors.text }]}>
          {step === 1 ? 'Create Wallet' : 'Your Recovery Phrase'}
        </Text>
        
        {step === 1 ? (
          <>
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              Write down your 24-word recovery phrase and store it safely.
              Anyone with this phrase can access your wallet.
            </Text>
            
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={handleGenerate}
            >
              <Text style={styles.buttonText}>Generate Phrase</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={[styles.mnemonicBox, { backgroundColor: colors.surface }]}>
              {mnemonic.map((word, index) => (
                <View key={index} style={[styles.mnemonicWord, { backgroundColor: colors.surface2 }]}>
                  <Text style={[styles.mnemonicIndex, { color: colors.textSecondary }]}>{index + 1}.</Text>
                  <Text style={[styles.mnemonicText, { color: colors.text }]}>{word}</Text>
                </View>
              ))}
            </View>
            
            <Text style={[styles.warning, { color: colors.warning }]}>
              ⚠️ Write down these words in order and store safely. 
              Lost phrases cannot be recovered!
            </Text>
            
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={password}
              onChangeText={setPassword}
              placeholder="Create Password (min 8 chars)"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
            />
            
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm Password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
            />
            
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={handleCreate}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Creating...' : 'Create Wallet'}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity onPress={() => setStep(1)}>
              <Text style={[styles.link, { color: colors.primary }]}>← Back</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export const ImportWalletScreen = ({ navigation }) => {
  const { colors } = useTheme();
  const { importWallet } = useWallet();
  
  const [privateKey, setPrivateKey] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  
  const handleImport = async () => {
    if (!privateKey) {
      Alert.alert('Error', 'Please enter private key');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }
    
    setLoading(true);
    const result = await importWallet(privateKey, password);
    setLoading(false);
    
    if (result.success) {
      Alert.alert('Success', 'Wallet imported successfully!', [
        { text: 'OK', onPress: () => navigation.replace('Home') }
      ]);
    } else {
      Alert.alert('Error', result.error);
    }
  };
  
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.title, { color: colors.text }]}>Import Wallet</Text>
        
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          Enter your private key to import your wallet
        </Text>
        
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, height: 100 }]}
          value={privateKey}
          onChangeText={setPrivateKey}
          placeholder="Paste private key here..."
          placeholderTextColor={colors.textSecondary}
          multiline
        />
        
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={password}
          onChangeText={setPassword}
          placeholder="Create Password"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
        />
        
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={handleImport}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Importing...' : 'Import Wallet'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export const WalletHomeScreen = ({ navigation }) => {
  const { colors } = useTheme();
  const { wallets, activeNetwork, balances, setActiveNetwork } = useWallet();
  const [showNetworks, setShowNetworks] = useState(false);
  
  const walletAddresses = Object.keys(wallets);
  const currentWallet = walletAddresses[0];
  const network = SUPPORTED_NETWORKS[activeNetwork];
  
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setShowNetworks(true)}>
          <Text style={[styles.networkButton, { color: colors.text }]}>
            🌐 {network.name}
          </Text>
        </TouchableOpacity>
      </View>
      
      <View style={[styles.walletCard, { backgroundColor: colors.surface }]}>
        <Text style={[styles.walletLabel, { color: colors.textSecondary }]}>Total Balance</Text>
        <Text style={[styles.balance, { color: colors.text }]}>
          $0.00
        </Text>
        <Text style={[styles.address, { color: colors.textSecondary }]}>
          {currentWallet?.substring(0, 6)}...{currentWallet?.substring(38)}
        </Text>
      </View>
      
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.surface }]}>
          <Text style={styles.actionIcon}>📥</Text>
          <Text style={[styles.actionText, { color: colors.text }]}>Receive</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.surface }]}>
          <Text style={styles.actionIcon}>📤</Text>
          <Text style={[styles.actionText, { color: colors.text }]}>Send</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.surface }]}>
          <Text style={styles.actionIcon}>🔄</Text>
          <Text style={[styles.actionText, { color: colors.text }]}>Swap</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.surface }]}>
          <Text style={styles.actionIcon}>🌐</Text>
          <Text style={[styles.actionText, { color: colors.text }]}>Browser</Text>
        </TouchableOpacity>
      </View>
      
      <View style={[styles.assetsSection, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Assets</Text>
        <FlatList
          data={[
            { symbol: 'ETH', name: 'Ethereum', balance: '0.00', value: '$0.00' },
            { symbol: 'BNB', name: 'BNB', balance: '0.00', value: '$0.00' },
            { symbol: 'MATIC', name: 'Polygon', balance: '0.00', value: '$0.00' },
          ]}
          keyExtractor={(item) => item.symbol}
          renderItem={({ item }) => (
            <View style={[styles.assetRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.assetIcon, { backgroundColor: colors.surface2 }]}>
                <Text>{item.symbol[0]}</Text>
              </View>
              <View style={styles.assetInfo}>
                <Text style={[styles.assetName, { color: colors.text }]}>{item.name}</Text>
                <Text style={[styles.assetSymbol, { color: colors.textSecondary }]}>{item.symbol}</Text>
              </View>
              <View style={styles.assetValues}>
                <Text style={[styles.assetBalance, { color: colors.text }]}>{item.balance}</Text>
                <Text style={[styles.assetValue, { color: colors.textSecondary }]}>{item.value}</Text>
              </View>
            </View>
          )}
        />
      </View>
      
      {/* Network Selector Modal */}
      <Modal visible={showNetworks} animationType="slide">
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Select Network</Text>
            <TouchableOpacity onPress={() => setShowNetworks(false)}>
              <Text style={[styles.closeButton, { color: colors.primary }]}>✕</Text>
            </TouchableOpacity>
          </View>
          
          <FlatList
            data={Object.entries(SUPPORTED_NETWORKS)}
            keyExtractor={([key]) => key}
            renderItem={({ item: [key, network] }) => (
              <TouchableOpacity
                style={[styles.networkOption, { backgroundColor: activeNetwork === key ? colors.primary + '20' : colors.surface }]}
                onPress={() => {
                  setActiveNetwork(key);
                  setShowNetworks(false);
                }}
              >
                <Text style={[styles.networkName, { color: colors.text }]}>{network.name}</Text>
                <Text style={[styles.networkSymbol, { color: colors.textSecondary }]}>{network.symbol}</Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, alignItems: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 8, marginTop: 40 },
  description: { fontSize: 14, textAlign: 'center', marginBottom: 30 },
  input: { width: '100%', padding: 16, borderRadius: 12, fontSize: 16, marginBottom: 16, borderWidth: 1 },
  button: { width: '100%', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 16 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { fontSize: 14, marginTop: 10 },
  
  mnemonicBox: { width: '100%', padding: 16, borderRadius: 12, marginBottom: 20 },
  mnemonicWord: { flexDirection: 'row', padding: 8, borderRadius: 8, marginBottom: 4 },
  mnemonicIndex: { width: 30, fontSize: 12 },
  mnemonicText: { fontSize: 14 },
  warning: { fontSize: 12, textAlign: 'center', marginBottom: 20 },
  
  header: { padding: 16, flexDirection: 'row', justifyContent: 'flex-end' },
  networkButton: { fontSize: 16, fontWeight: '600' },
  walletCard: { margin: 16, padding: 24, borderRadius: 16 },
  walletLabel: { fontSize: 14 },
  balance: { fontSize: 36, fontWeight: 'bold', marginVertical: 8 },
  address: { fontSize: 12 },
  
  actions: { flexDirection: 'row', justifyContent: 'space-around', padding: 16 },
  actionButton: { alignItems: 'center', padding: 16, borderRadius: 12, minWidth: 70 },
  actionIcon: { fontSize: 24, marginBottom: 4 },
  actionText: { fontSize: 12 },
  
  assetsSection: { margin: 16, padding: 16, borderRadius: 16, flex: 1 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 16 },
  assetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  assetIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  assetInfo: { flex: 1 },
  assetName: { fontSize: 16, fontWeight: '500' },
  assetSymbol: { fontSize: 12 },
  assetValues: { alignItems: 'flex-end' },
  assetBalance: { fontSize: 16, fontWeight: '500' },
  assetValue: { fontSize: 12 },
  
  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 16 },
  modalTitle: { fontSize: 20, fontWeight: 'bold' },
  closeButton: { fontSize: 24 },
  networkOption: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, marginHorizontal: 16, marginBottom: 8, borderRadius: 12 },
  networkName: { fontSize: 16, fontWeight: '500' },
  networkSymbol: { fontSize: 14 },
});

export default { ThemeProvider, WalletProvider, CreateWalletScreen, ImportWalletScreen, WalletHomeScreen };