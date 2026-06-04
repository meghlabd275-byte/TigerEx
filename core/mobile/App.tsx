/**
 * TigerEx Mobile App (React Native + Expo)
 * Cross-platform mobile application for iOS and Android
 * 
 * Features:
 * - Unified auth with smart email/phone detection
 * - Trading interface
 * - Web3 wallet
 * - Real-time updates
 */

import React, { useState, useEffect, createContext, useContext } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, 
  ScrollView, FlatList, StyleSheet,
  SafeAreaView, StatusBar, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ethers } from 'ethers';

// ============================================================================
// THEME CONTEXT - Light/Dark Mode
// ============================================================================

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(true);
  
  const colors = isDark ? {
    background: '#0a0a0a',
    surface: '#1a1a1a',
    surface2: '#2a2a2a',
    primary: '#f97316',
    primaryLight: '#fb923c',
    text: '#ffffff',
    textSecondary: '#a0a0a0',
    border: '#333333',
    success: '#22c55e',
    error: '#ef4444',
    warning: '#eab308',
  } : {
    background: '#f5f5f5',
    surface: '#ffffff',
    surface2: '#f0f0f0',
    primary: '#f97316',
    primaryLight: '#fb923c',
    text: '#1a1a1a',
    textSecondary: '#666666',
    border: '#e0e0e0',
    success: '#16a34a',
    error: '#dc2626',
    warning: '#ca8a04',
  };
  
  const toggleTheme = () => setIsDark(!isDark);
  
  return (
    <ThemeContext.Provider value={{ isDark, colors, toggleTheme }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

// ============================================================================
// API CLIENT
// ============================================================================

const API_BASE_URL = 'http://localhost:8080/api/v1';

class ApiClient {
  constructor() {
    this.token = null;
  }
  
  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      ...options.headers,
    };
    
    try {
      const response = await fetch(url, { ...options, headers });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'Request failed');
      }
      
      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }
  
  async login(identifier, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
    if (data.data?.accessToken) {
      this.token = data.data.accessToken;
      await AsyncStorage.setItem('token', this.token);
    }
    return data;
  }
  
  async register(identifier, password, username) {
    const data = await this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, username }),
    });
    if (data.data?.accessToken) {
      this.token = data.data.accessToken;
      await AsyncStorage.setItem('token', this.token);
    }
    return data;
  }
  
  async getMarkets() {
    return this.request('/markets');
  }
  
  async getOrderBook(symbol) {
    return this.request(`/markets/${symbol}/orderbook`);
  }
  
  async getBalances() {
    return this.request('/wallet/balances');
  }
  
  async placeOrder(order) {
    return this.request('/spot/order', {
      method: 'POST',
      body: JSON.stringify(order),
    });
  }
  
  async logout() {
    await this.request('/auth/logout', { method: 'POST' });
    this.token = null;
    await AsyncStorage.removeItem('token');
  }
  
  async loadToken() {
    this.token = await AsyncStorage.getItem('token');
  }
}

export const api = new ApiClient();

// ============================================================================
// SMART INPUT - Auto Email/Phone Detection
// ============================================================================

export const SmartInput = ({ value, onChangeText, onModeChange, placeholder, ...props }) => {
  const { colors } = useTheme();
  const [mode, setMode] = useState('email'); // 'email' or 'phone'
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countryCode, setCountryCode] = useState('+1');
  
  // Auto-detect mode based on input
  useEffect(() => {
    if (value) {
      const isNumeric = /^\d+$/.test(value.replace(/[\s\-\(\)]/g, ''));
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      
      if (isEmail) {
        setMode('email');
        onModeChange?.('email');
      } else if (isNumeric) {
        setMode('phone');
        onModeChange?.('phone');
      }
    }
  }, [value]);
  
  const countries = [
    { code: '+1', name: 'US', flag: '🇺🇸' },
    { code: '+44', name: 'UK', flag: '🇬🇧' },
    { code: '+86', name: 'CN', flag: '🇨🇳' },
    { code: '+91', name: 'IN', flag: '🇮🇳' },
    { code: '+81', name: 'JP', flag: '🇯🇵' },
    { code: '+49', name: 'DE', flag: '🇩🇪' },
    { code: '+33', name: 'FR', flag: '🇫🇷' },
    { code: '+82', name: 'KR', flag: '🇰🇷' },
    { code: '+61', name: 'AU', flag: '🇦🇺' },
    { code: '+55', name: 'BR', flag: '🇧🇷' },
  ];
  
  return (
    <View style={styles.smartInputContainer}>
      {mode === 'phone' && (
        <TouchableOpacity 
          style={[styles.countrySelector, { backgroundColor: colors.surface2 }]}
          onPress={() => setShowCountryPicker(!showCountryPicker)}
        >
          <Text style={[styles.countryFlag, { color: colors.text }]}>
            {countries.find(c => c.code === countryCode)?.flag || '🌍'}
          </Text>
          <Text style={[styles.countryCode, { color: colors.text }]}>{countryCode}</Text>
        </TouchableOpacity>
      )}
      
      {showCountryPicker && (
        <View style={[styles.countryPicker, { backgroundColor: colors.surface }]}>
          <FlatList
            data={countries}
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.countryItem, { borderBottomColor: colors.border }]}
                onPress={() => {
                  setCountryCode(item.code);
                  setShowCountryPicker(false);
                }}
              >
                <Text style={styles.countryItemText}>{item.flag} {item.name} {item.code}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
      
      <TextInput
        style={[
          styles.smartInput,
          { 
            backgroundColor: colors.surface,
            color: colors.text,
            borderColor: colors.border,
          },
          mode === 'phone' && { paddingLeft: 80 }
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || (mode === 'email' ? 'email@example.com' : '+1 234 567 8900')}
        placeholderTextColor={colors.textSecondary}
        keyboardType={mode === 'phone' ? 'phone-pad' : 'email-address'}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
      />
      
      <View style={styles.modeIndicator}>
        <Text style={[styles.modeText, { color: colors.primary }]}>
          {mode === 'email' ? '📧 Email' : '📱 Phone'}
        </Text>
      </View>
    </View>
  );
};

// ============================================================================
// SCREENS
// ============================================================================

const Stack = createStackNavigator();

// Login Screen
export const LoginScreen = ({ navigation }) => {
  const { colors, isDark, toggleTheme } = useTheme();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('email');
  
  const handleLogin = async () => {
    if (!identifier || !password) {
      setError('Please fill in all fields');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      await api.loadToken();
      const result = await api.login(identifier, password);
      
      if (result.success) {
        navigation.replace('Home');
      } else {
        setError(result.error?.message || 'Login failed');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity style={styles.themeToggle} onPress={toggleTheme}>
            <Text style={[styles.themeText, { color: colors.text }]}>
              {isDark ? '🌙 Dark' : '☀️ Light'}
            </Text>
          </TouchableOpacity>
          
          <Text style={[styles.title, { color: colors.text }]}>TigerEx</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Sign in to your account
          </Text>
          
          <SmartInput
            value={identifier}
            onChangeText={setIdentifier}
            onModeChange={setMode}
            placeholder={mode === 'email' ? 'Email or Phone' : 'Phone number'}
          />
          
          <View style={styles.passwordContainer}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
            />
            <TouchableOpacity style={styles.eyeButton}>
              <Text style={{ color: colors.text }}>👁️</Text>
            </TouchableOpacity>
          </View>
          
          {error ? (
            <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
          ) : null}
          
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>
          
          <View style={styles.links}>
            <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')}>
              <Text style={[styles.link, { color: colors.primary }]}>Forgot Password?</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.textSecondary }]}>OR</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>
          
          <View style={styles.socialButtons}>
            <TouchableOpacity style={[styles.socialButton, { backgroundColor: colors.surface }]}>
              <Text style={styles.socialIcon}>🔵</Text>
              <Text style={[styles.socialText, { color: colors.text }]}>Google</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.socialButton, { backgroundColor: colors.surface }]}>
              <Text style={styles.socialIcon}>🍎</Text>
              <Text style={[styles.socialText, { color: colors.text }]}>Apple</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.socialButton, { backgroundColor: colors.surface }]}>
              <Text style={styles.socialIcon}>🦊</Text>
              <Text style={[styles.socialText, { color: colors.text }]}>MetaMask</Text>
            </TouchableOpacity>
          </View>
          
          <TouchableOpacity
            style={styles.registerLink}
            onPress={() => navigation.navigate('Register')}
          >
            <Text style={[styles.registerText, { color: colors.textSecondary }]}>
              Don't have an account? 
              <Text style={{ color: colors.primary }}> Sign Up</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// Register Screen
export const RegisterScreen = ({ navigation }) => {
  const { colors } = useTheme();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('email');
  
  const getPasswordStrength = (pwd) => {
    if (!pwd) return { level: 0, text: '', color: '' };
    if (pwd.length < 8) return { level: 1, text: 'Weak', color: colors.error };
    if (pwd.length < 12 || !/[A-Z]/.test(pwd)) return { level: 2, text: 'Medium', color: colors.warning };
    return { level: 3, text: 'Strong', color: colors.success };
  };
  
  const strength = getPasswordStrength(password);
  
  const handleRegister = async () => {
    if (!identifier || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const result = await api.register(identifier, password, username || identifier.split('@')[0]);
      if (result.success) {
        navigation.replace('Home');
      } else {
        setError(result.error?.message || 'Registration failed');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={[styles.title, { color: colors.text }]}>Create Account</Text>
          
          <SmartInput
            value={identifier}
            onChangeText={setIdentifier}
            onModeChange={setMode}
            placeholder={mode === 'email' ? 'Email or Phone' : 'Phone number'}
          />
          
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
            value={username}
            onChangeText={setUsername}
            placeholder="Username (optional)"
            placeholderTextColor={colors.textSecondary}
          />
          
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
          />
          
          {password ? (
            <View style={styles.strengthBar}>
              <View style={[styles.strengthFill, { 
                width: `${strength.level * 33}%`,
                backgroundColor: strength.color 
              }]} />
            </View>
          ) : null}
          <Text style={[styles.strengthText, { color: strength.color }]}>{strength.text}</Text>
          
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm Password"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
          />
          
          {error ? (
            <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
          ) : null}
          
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign Up</Text>
            )}
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.registerLink}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={[styles.registerText, { color: colors.textSecondary }]}>
              Already have an account? 
              <Text style={{ color: colors.primary }}> Sign In</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// Home Screen (Trading)
export const HomeScreen = ({ navigation }) => {
  const { colors, isDark, toggleTheme } = useTheme();
  const [markets, setMarkets] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState('BTC-USDT');
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [] });
  
  useEffect(() => {
    loadMarkets();
    loadOrderBook();
    
    // Subscribe to updates
    const interval = setInterval(loadOrderBook, 1000);
    return () => clearInterval(interval);
  }, [selectedSymbol]);
  
  const loadMarkets = async () => {
    try {
      const data = await api.getMarkets();
      if (data.success) {
        setMarkets(data.data || []);
      }
    } catch (err) {
      console.error('Failed to load markets:', err);
    }
  };
  
  const loadOrderBook = async () => {
    try {
      const data = await api.getOrderBook(selectedSymbol);
      if (data.success) {
        setOrderBook(data.data || { bids: [], asks: [] });
      }
    } catch (err) {
      console.error('Failed to load order book:', err);
    }
  };
  
  const renderMarketItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.marketItem, { backgroundColor: colors.surface }]}
      onPress={() => setSelectedSymbol(item.symbol)}
    >
      <View>
        <Text style={[styles.marketSymbol, { color: colors.text }]}>{item.symbol}</Text>
        <Text style={[styles.marketPrice, { color: colors.textSecondary }]}>
          ${item.price?.toFixed(2)}
        </Text>
      </View>
      <Text style={[
        styles.marketChange,
        { color: item.priceChange >= 0 ? colors.success : colors.error }
      ]}>
        {item.priceChange >= 0 ? '+' : ''}{item.priceChange?.toFixed(2)}%
      </Text>
    </TouchableOpacity>
  );
  
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>TigerEx</Text>
        <TouchableOpacity onPress={toggleTheme}>
          <Text style={{ fontSize: 24 }}>{isDark ? '🌙' : '☀️'}</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.tabs}>
        {['Markets', 'Trade', 'Wallet', 'More'].map((tab, index) => (
          <TouchableOpacity key={tab} style={styles.tab}>
            <Text style={[styles.tabText, { color: index === 0 ? colors.primary : colors.textSecondary }]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      
      <View style={styles.selectedPair}>
        <Text style={[styles.pairText, { color: colors.text }]}>{selectedSymbol}</Text>
        <Text style={[styles.pairPrice, { color: colors.text }]}>
          ${markets.find(m => m.symbol === selectedSymbol)?.price?.toFixed(2) || '0.00'}
        </Text>
      </View>
      
      <View style={styles.orderBookContainer}>
        <View style={styles.orderBook}>
          <Text style={[styles.orderBookTitle, { color: colors.text }]}>Order Book</Text>
          
          <View style={styles.orderBookHeader}>
            <Text style={[styles.orderBookHeaderText, { color: colors.textSecondary }]}>Price</Text>
            <Text style={[styles.orderBookHeaderText, { color: colors.textSecondary }]}>Amount</Text>
            <Text style={[styles.orderBookHeaderText, { color: colors.textSecondary }]}>Total</Text>
          </View>
          
          <FlatList
            data={orderBook.asks?.slice(0, 10).reverse() || []}
            keyExtractor={(item, i) => `ask-${i}`}
            renderItem={({ item }) => (
              <View style={styles.orderBookRow}>
                <Text style={[styles.askPrice, { color: colors.error }]}>{item[0]}</Text>
                <Text style={[styles.orderBookText, { color: colors.text }]}>{item[1]}</Text>
                <Text style={[styles.orderBookText, { color: colors.textSecondary }]}>{item[2] || (item[0] * item[1]).toFixed(2)}</Text>
              </View>
            )}
          />
          
          <View style={[styles.spread, { backgroundColor: colors.surface2 }]}>
            <Text style={[styles.spreadText, { color: colors.text }]}>
              Spread: ${((orderBook.asks?.[0]?.[0] || 0) - (orderBook.bids?.[0]?.[0] || 0)).toFixed(2)}
            </Text>
          </View>
          
          <FlatList
            data={orderBook.bids?.slice(0, 10) || []}
            keyExtractor={(item, i) => `bid-${i}`}
            renderItem={({ item }) => (
              <View style={styles.orderBookRow}>
                <Text style={[styles.bidPrice, { color: colors.success }]}>{item[0]}</Text>
                <Text style={[styles.orderBookText, { color: colors.text }]}>{item[1]}</Text>
                <Text style={[styles.orderBookText, { color: colors.textSecondary }]}>{item[2] || (item[0] * item[1]).toFixed(2)}</Text>
              </View>
            )}
          />
        </View>
      </View>
      
      <FlatList
        horizontal
        data={markets}
        keyExtractor={(item) => item.symbol}
        renderItem={renderMarketItem}
        style={styles.marketList}
        showsHorizontalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

// ============================================================================
// MAIN APP
// ============================================================================

export default function App() {
  return (
    <ThemeProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Login">
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Register" component={RegisterScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeProvider>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    alignItems: 'center',
  },
  themeToggle: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
  },
  themeText: {
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
    marginTop: 60,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 30,
  },
  input: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  passwordContainer: {
    width: '100%',
    position: 'relative',
  },
  eyeButton: {
    position: 'absolute',
    right: 16,
    top: 16,
  },
  smartInputContainer: {
    width: '100%',
    marginBottom: 16,
    position: 'relative',
  },
  smartInput: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
    borderWidth: 1,
  },
  countrySelector: {
    position: 'absolute',
    left: 8,
    top: 8,
    bottom: 8,
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  countryFlag: {
    fontSize: 20,
  },
  countryCode: {
    fontSize: 12,
    fontWeight: '600',
  },
  countryPicker: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    height: 200,
    zIndex: 100,
    borderRadius: 12,
    elevation: 5,
  },
  countryItem: {
    padding: 16,
    borderBottomWidth: 1,
  },
  countryItemText: {
    fontSize: 16,
  },
  modeIndicator: {
    position: 'absolute',
    right: 16,
    top: 16,
  },
  modeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  strengthBar: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    backgroundColor: '#333',
    marginBottom: 4,
  },
  strengthFill: {
    height: '100%',
    borderRadius: 2,
  },
  strengthText: {
    fontSize: 12,
    marginBottom: 16,
    marginLeft: 4,
  },
  error: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  button: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  links: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  link: {
    fontSize: 14,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
    width: '100%',
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 16,
  },
  socialButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  socialIcon: {
    fontSize: 20,
  },
  socialText: {
    fontSize: 14,
    fontWeight: '500',
  },
  registerLink: {
    marginTop: 20,
  },
  registerText: {
    fontSize: 14,
  },
  
  // Home screen styles
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 50,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  tabText: {
    fontSize: 16,
    fontWeight: '500',
  },
  selectedPair: {
    padding: 16,
    alignItems: 'center',
  },
  pairText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  pairPrice: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  orderBookContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  orderBook: {
    flex: 1,
  },
  orderBookTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  orderBookHeader: {
    flexDirection: 'row',
    paddingVertical: 8,
  },
  orderBookHeaderText: {
    flex: 1,
    fontSize: 12,
  },
  orderBookRow: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  bidPrice: {
    flex: 1,
    fontSize: 14,
  },
  askPrice: {
    flex: 1,
    fontSize: 14,
  },
  orderBookText: {
    flex: 1,
    fontSize: 14,
    textAlign: 'right',
  },
  spread: {
    padding: 8,
    borderRadius: 4,
    marginVertical: 8,
  },
  spreadText: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '500',
  },
  marketList: {
    maxHeight: 100,
  },
  marketItem: {
    padding: 12,
    marginHorizontal: 6,
    borderRadius: 8,
    minWidth: 120,
  },
  marketSymbol: {
    fontSize: 14,
    fontWeight: '600',
  },
  marketPrice: {
    fontSize: 14,
  },
  marketChange: {
    fontSize: 12,
    marginTop: 4,
  },
});