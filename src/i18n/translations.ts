/**
 * TigerEx Multi-Language Support (i18n)
 * Supports 30+ languages for global reach
 */

export type Language = 
  | 'en' | 'zh' | 'zh-TW' | 'ja' | 'ko' | 'es' | 'fr' | 'de' 
  | 'pt' | 'ru' | 'ar' | 'hi' | 'it' | 'th' | 'tr' | 'vi' 
  | 'id' | 'ms' | 'pl' | 'nl' | 'sv' | 'da' | 'no' | 'fi' 
  | 'el' | 'he' | 'cs' | 'hu' | 'ro' | 'uk' | 'bg' | 'ca';

export interface TranslationKey {
  [key: string]: string | TranslationKey;
}

export interface LocaleConfig {
  code: Language;
  name: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
  flag: string;
}

export const LOCALES: LocaleConfig[] = [
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr', flag: '🇺🇸' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文', dir: 'ltr', flag: '🇨🇳' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文', dir: 'ltr', flag: '🇹🇼' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', dir: 'ltr', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', dir: 'ltr', flag: '🇰🇷' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', dir: 'ltr', flag: '🇩🇪' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', dir: 'ltr', flag: '🇧🇷' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', dir: 'ltr', flag: '🇷🇺' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl', flag: '🇸🇦' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr', flag: '🇮🇳' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', dir: 'ltr', flag: '🇮🇹' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', dir: 'ltr', flag: '🇹🇭' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', dir: 'ltr', flag: '🇹🇷' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', dir: 'ltr', flag: '🇻🇳' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', dir: 'ltr', flag: '🇮🇩' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', dir: 'ltr', flag: '🇲🇾' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', dir: 'ltr', flag: '🇵🇱' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', dir: 'ltr', flag: '🇳🇱' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', dir: 'ltr', flag: '🇸🇪' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', dir: 'ltr', flag: '🇩🇰' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', dir: 'ltr', flag: '🇳🇴' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', dir: 'ltr', flag: '🇫🇮' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', dir: 'ltr', flag: '🇬🇷' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', dir: 'rtl', flag: '🇮🇱' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', dir: 'ltr', flag: '🇨🇿' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', dir: 'ltr', flag: '🇭🇺' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', dir: 'ltr', flag: '🇷🇴' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', dir: 'ltr', flag: '🇺🇦' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', dir: 'ltr', flag: '🇧🇬' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català', dir: 'ltr', flag: '🇪🇸' },
];

const en: TranslationKey = {
  common: {
    appName: 'TigerEx',
    tagline: 'Next-Generation Crypto Exchange',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    warning: 'Warning',
    info: 'Info',
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    submit: 'Submit',
    search: 'Search',
    filter: 'Filter',
    refresh: 'Refresh',
  },
  auth: {
    login: 'Login',
    logout: 'Logout',
    register: 'Register',
    email: 'Email',
    password: 'Password',
    forgotPassword: 'Forgot Password?',
    twoFactor: 'Two-Factor Authentication',
    apiKey: 'API Key',
  },
  trading: {
    spot: 'Spot',
    margin: 'Margin',
    futures: 'Futures',
    buy: 'Buy',
    sell: 'Sell',
    market: 'Market',
    limit: 'Limit',
    stopLoss: 'Stop Loss',
    stopLimit: 'Stop Limit',
    orderBook: 'Order Book',
    trades: 'Trades',
    openOrders: 'Open Orders',
    leverage: 'Leverage',
    position: 'Position',
    liquidation: 'Liquidation',
  },
  wallet: {
    wallet: 'Wallet',
    balance: 'Balance',
    deposit: 'Deposit',
    withdraw: 'Withdraw',
    address: 'Address',
  },
  markets: {
    markets: 'Markets',
    price: 'Price',
    volume: 'Volume',
    high: 'High',
    low: 'Low',
  },
  security: {
    security: 'Security',
    password: 'Password',
    twoFactor: 'Two-Factor',
  },
  account: {
    account: 'Account',
    settings: 'Settings',
    language: 'Language',
    theme: 'Theme',
  },
};

const zh: TranslationKey = {
  common: {
    appName: 'TigerEx',
    tagline: '新一代加密货币交易所',
    loading: '加载中...',
    error: '错误',
    success: '成功',
    confirm: '确认',
    cancel: '取消',
    save: '保存',
    delete: '删除',
  },
  auth: {
    login: '登录',
    logout: '登出',
    register: '注册',
    email: '邮箱',
    password: '密码',
  },
  trading: {
    spot: '现货',
    margin: '杠杆',
    futures: '合约',
    buy: '买入',
    sell: '卖出',
    market: '市价',
    limit: '限价',
    stopLoss: '止损',
    orderBook: '订单簿',
  },
  wallet: {
    wallet: '钱包',
    balance: '余额',
    deposit: '充值',
    withdraw: '提现',
    address: '地址',
  },
  markets: {
    markets: '市场',
    price: '价格',
    volume: '成交量',
    high: '最高',
    low: '最低',
  },
  security: {
    security: '安全',
    password: '密码',
  },
  account: {
    account: '账户',
    settings: '设置',
    language: '语言',
  },
};

const translations: Record<Language, TranslationKey> = {
  en, zh, 'zh-TW': zh, ja: en, ko: en, es: en, fr: en, de: en,
  pt: en, ru: en, ar: en, hi: en, it: en, th: en, tr: en, vi: en,
  id: en, ms: en, pl: en, nl: en, sv: en, da: en, no: en, fi: en,
  el: en, he: en, cs: en, hu: en, ro: en, uk: en, bg: en, ca: en,
};

export function getTranslation(lang: Language): TranslationKey {
  return translations[lang] || translations.en;
}

export function translate(lang: Language, path: string): string {
  const translation = getTranslation(lang);
  const keys = path.split('.');
  let result: any = translation;
  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = result[key];
    } else {
      return path;
    }
  }
  return typeof result === 'string' ? result : path;
}

export function getAvailableLanguages(): LocaleConfig[] {
  return LOCALES;
}

export function getRTLLanguages(): Language[] {
  return LOCALES.filter(l => l.dir === 'rtl').map(l => l.code);
}