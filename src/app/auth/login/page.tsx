'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

// ============================================================================
// THEME CONTEXT
// ============================================================================

interface Theme {
  mode: 'light' | 'dark';
  colors: {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    error: string;
    success: string;
    warning: string;
    info: string;
  };
}

const lightTheme: Theme = {
  mode: 'light',
  colors: {
    primary: '#f97316',
    secondary: '#ea580c',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    textSecondary: '#64748b',
    border: '#e2e8f0',
    error: '#ef4444',
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#3b82f6',
  },
};

const darkTheme: Theme = {
  mode: 'dark',
  colors: {
    primary: '#f97316',
    secondary: '#fb923c',
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    textSecondary: '#94a3b8',
    border: '#334155',
    error: '#f87171',
    success: '#4ade80',
    warning: '#fbbf24',
    info: '#60a5fa',
  },
};

const ThemeContext = React.createContext<{
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (mode: 'light' | 'dark') => void;
}>({
  theme: lightTheme,
  toggleTheme: () => {},
  setTheme: () => {},
});

const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(lightTheme);

  useEffect(() => {
    const savedTheme = localStorage.getItem('tigerex-theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setTheme(darkTheme);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const newTheme = prev.mode === 'light' ? darkTheme : lightTheme;
      localStorage.setItem('tigerex-theme', newTheme.mode);
      return newTheme;
    });
  }, []);

  const setThemeMode = useCallback((mode: 'light' | 'dark') => {
    setTheme(mode === 'light' ? lightTheme : darkTheme);
    localStorage.setItem('tigerex-theme', mode);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

const useTheme = () => React.useContext(ThemeContext);

// ============================================================================
// TYPES
// ============================================================================

interface CredentialDetection {
  type: 'email' | 'phone' | 'unknown';
  credential: string;
  countryCode?: string;
  valid: boolean;
  normalized: string;
}

interface LoginResponse {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  requires2FA?: boolean;
  requiresOTP?: boolean;
  tempToken?: string;
  message?: string;
  securityMessage?: string;
}

interface PasswordStrength {
  score: number;
  label: 'very_weak' | 'weak' | 'medium' | 'strong' | 'very_strong';
  color: string;
  message: string;
}

const COUNTRIES = [
  { code: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧' },
  { code: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷' },
  { code: 'JP', name: 'Japan', dialCode: '+81', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', dialCode: '+82', flag: '🇰🇷' },
  { code: 'CN', name: 'China', dialCode: '+86', flag: '🇨🇳' },
  { code: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { code: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷' },
  { code: 'RU', name: 'Russia', dialCode: '+7', flag: '🇷🇺' },
  { code: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { code: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸' },
  { code: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱' },
  { code: 'SE', name: 'Sweden', dialCode: '+46', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', dialCode: '+47', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', dialCode: '+45', flag: '🇩🇰' },
  { code: 'FI', name: 'Finland', dialCode: '+358', flag: '🇫🇮' },
  { code: 'BE', name: 'Belgium', dialCode: '+32', flag: '🇧🇪' },
  { code: 'AT', name: 'Austria', dialCode: '+43', flag: '🇦🇹' },
  { code: 'CH', name: 'Switzerland', dialCode: '+41', flag: '🇨🇭' },
  { code: 'HK', name: 'Hong Kong', dialCode: '+852', flag: '🇭🇰' },
  { code: 'TW', name: 'Taiwan', dialCode: '+886', flag: '🇹🇼' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬' },
  { code: 'AE', name: 'UAE', dialCode: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', flag: '🇸🇦' },
  { code: 'TR', name: 'Turkey', dialCode: '+90', flag: '🇹🇷' },
  { code: 'TH', name: 'Thailand', dialCode: '+66', flag: '🇹🇭' },
  { code: 'VN', name: 'Vietnam', dialCode: '+84', flag: '🇻🇳' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62', flag: '🇮🇩' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾' },
  { code: 'PH', name: 'Philippines', dialCode: '+63', flag: '🇵🇭' },
  { code: 'NG', name: 'Nigeria', dialCode: '+234', flag: '🇳🇬' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦' },
  { code: 'EG', name: 'Egypt', dialCode: '+20', flag: '🇪🇬' },
  { code: 'BD', name: 'Bangladesh', dialCode: '+880', flag: '🇧🇩' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92', flag: '🇵🇰' },
  { code: 'MX', name: 'Mexico', dialCode: '+52', flag: '🇲🇽' },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
  { code: 'PL', name: 'Poland', dialCode: '+48', flag: '🇵🇱' },
  { code: 'RO', name: 'Romania', dialCode: '+40', flag: '🇷🇴' },
  { code: 'UA', name: 'Ukraine', dialCode: '+380', flag: '🇺🇦' },
  { code: 'CO', name: 'Colombia', dialCode: '+57', flag: '🇨🇴' },
  { code: 'CL', name: 'Chile', dialCode: '+56', flag: '🇨🇱' },
  { code: 'PE', name: 'Peru', dialCode: '+51', flag: '🇵🇪' },
  { code: 'AR', name: 'Argentina', dialCode: '+54', flag: '🇦🇷' },
];

// ============================================================================
// UNIFIED SMART INPUT COMPONENT
// ============================================================================

interface UnifiedInputProps {
  value: string;
  onChange: (value: string, detection: CredentialDetection) => void;
  onValidationChange?: (valid: boolean) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

const UnifiedSmartInput: React.FC<UnifiedInputProps> = ({
  value,
  onChange,
  onValidationChange,
  placeholder = 'Enter email or phone number',
  autoFocus = false,
  disabled = false,
}) => {
  const { theme } = useTheme();
  const [detection, setDetection] = useState<CredentialDetection>({
    type: 'unknown',
    credential: '',
    valid: false,
    normalized: '',
  });
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0]);
  const [isLoading, setIsLoading] = useState(false);

  const detectCredential = useCallback((input: string): CredentialDetection => {
    const trimmed = input.trim();
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    const phoneDigits = trimmed.replace(/[\s\-\(\)\.]+/g, '').replace(/^\+/, '');
    const phoneRegex = /^[1-9]\d{7,14}$/;
    
    if (emailRegex.test(trimmed)) {
      return {
        type: 'email',
        credential: trimmed,
        valid: true,
        normalized: trimmed.toLowerCase(),
      };
    }
    
    if (phoneRegex.test(phoneDigits) && phoneDigits.length >= 8) {
      let countryCode = '';
      for (const country of COUNTRIES) {
        const code = country.dialCode.replace('+', '');
        if (phoneDigits.startsWith(code)) {
          countryCode = country.code;
          break;
        }
      }
      return {
        type: 'phone',
        credential: trimmed,
        countryCode,
        valid: true,
        normalized: phoneDigits,
      };
    }
    
    return {
      type: 'unknown',
      credential: trimmed,
      valid: false,
      normalized: '',
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    const newDetection = detectCredential(newValue);
    setDetection(newDetection);
    onChange(newValue, newDetection);
    onValidationChange?.(newDetection.valid);
  };

  const handleCountrySelect = (country: typeof COUNTRIES[0]) => {
    setSelectedCountry(country);
    setShowCountryDropdown(false);
    const currentValue = value.replace(/^\+\d+\s*/, '');
    const newValue = country.dialCode + ' ' + currentValue;
    const newDetection: CredentialDetection = {
      type: 'phone',
      credential: newValue,
      countryCode: country.code,
      valid: true,
      normalized: currentValue,
    };
    setDetection(newDetection);
    onChange(newValue, newDetection);
    onValidationChange?.(true);
  };

  const handleBlur = async () => {
    if (!detection.valid) return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/check-existence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: detection.normalized }),
      });
      await response.json();
    } catch (error) {
      console.error('Error checking credential:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center border rounded-lg overflow-hidden transition-all duration-200"
        style={{
          borderColor: detection.type === 'phone' && detection.valid ? (detection.countryCode ? theme.colors.primary : theme.colors.error) : theme.colors.border,
          backgroundColor: theme.colors.surface,
        }}>
        
        {detection.type === 'phone' && (
          <button
            type="button"
            onClick={() => setShowCountryDropdown(!showCountryDropdown)}
            className="flex items-center px-3 py-3 border-r hover:bg-opacity-10 hover:bg-gray-500 transition-colors"
            style={{ borderRightColor: theme.colors.border }}
          >
            <span className="text-lg mr-1">{selectedCountry.flag}</span>
            <span className="text-sm" style={{ color: theme.colors.textSecondary }}>{selectedCountry.dialCode}</span>
            <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
        
        <input
          type={detection.type === 'phone' ? 'tel' : detection.type === 'email' ? 'email' : 'text'}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          className={`flex-1 px-4 py-3 outline-none`}
          style={{
            backgroundColor: 'transparent',
            color: theme.colors.text,
          }}
        />
        
        {isLoading && (
          <div className="pr-4">
            <div className="animate-spin rounded-full h-5 w-5 border-2"
              style={{ borderTopColor: theme.colors.primary, borderColor: 'transparent' }} />
          </div>
        )}
        
        {detection.valid && !isLoading && (
          <div className="pr-4">
            <svg className="w-5 h-5" style={{ color: theme.colors.success }} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          </div>
        )}
        
        {detection.type === 'unknown' && value.length > 0 && !isLoading && (
          <div className="pr-4">
            <svg className="w-5 h-5" style={{ color: theme.colors.error }} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
        )}
      </div>
      
      <AnimatePresence>
        {showCountryDropdown && detection.type === 'phone' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-50 w-full mt-1 rounded-lg shadow-lg overflow-hidden"
            style={{ backgroundColor: theme.colors.surface, border: `1px solid ${theme.colors.border}` }}
          >
            <div className="max-h-60 overflow-y-auto">
              {COUNTRIES.map((country) => (
                <button
                  key={country.code}
                  type="button"
                  onClick={() => handleCountrySelect(country)}
                  className="w-full px-4 py-2 flex items-center hover:bg-opacity-10 hover:bg-gray-500 transition-colors"
                  style={{ color: theme.colors.text }}
                >
                  <span className="text-lg mr-3">{country.flag}</span>
                  <span className="flex-1 text-left">{country.name}</span>
                  <span style={{ color: theme.colors.textSecondary }}>{country.dialCode}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      <p className="mt-1 text-xs" style={{ color: theme.colors.textSecondary }}>
        {detection.type === 'email' && 'Enter your email address'}
        {detection.type === 'phone' && 'Enter your phone number with country code'}
        {detection.type === 'unknown' && value.length > 0 && 'Please enter a valid email or phone number'}
      </p>
    </div>
  );
};

// ============================================================================
// PASSWORD INPUT WITH STRENGTH INDICATOR
// ============================================================================

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  showStrength?: boolean;
  placeholder?: string;
}

const PasswordInput: React.FC<PasswordInputProps> = ({
  value,
  onChange,
  showStrength = true,
  placeholder = 'Enter password',
}) => {
  const { theme } = useTheme();
  const [showPassword, setShowPassword] = useState(false);
  const [strength, setStrength] = useState<PasswordStrength>({
    score: 0,
    label: 'very_weak',
    color: theme.colors.error,
    message: '',
  });

  useEffect(() => {
    if (!value) {
      setStrength({ score: 0, label: 'very_weak', color: theme.colors.error, message: '' });
      return;
    }

    let score = 0;
    if (value.length >= 8) score++;
    if (value.length >= 12) score++;
    if (value.length >= 16) score++;
    if (/[a-z]/.test(value)) score++;
    if (/[A-Z]/.test(value)) score++;
    if (/[0-9]/.test(value)) score++;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(value)) score++;
    if (value.length >= 12 && score >= 4) score++;

    let label: PasswordStrength['label'];
    let color: string;
    let message: string;

    switch (true) {
      case score <= 2:
        label = 'very_weak';
        color = '#ef4444';
        message = 'Very Weak - Add more characters and mix types';
        break;
      case score <= 3:
        label = 'weak';
        color = '#f97316';
        message = 'Weak - Add uppercase, numbers, and symbols';
        break;
      case score <= 5:
        label = 'medium';
        color = '#eab308';
        message = 'Medium - Consider adding more characters';
        break;
      case score <= 6:
        label = 'strong';
        color = '#22c55e';
        message = 'Strong - Good password';
        break;
      default:
        label = 'very_strong';
        color = '#15803d';
        message = 'Very Strong - Excellent password';
    }

    setStrength({ score, label, color, message });
  }, [value, theme.colors.error]);

  const strengthColors: Record<string, string> = {
    very_weak: '#ef4444',
    weak: '#f97316',
    medium: '#eab308',
    strong: '#22c55e',
    very_strong: '#15803d',
  };

  return (
    <div>
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-4 py-3 pr-12 outline-none rounded-lg"
          style={{
            backgroundColor: theme.colors.surface,
            color: theme.colors.text,
            borderColor: theme.colors.border,
            borderWidth: '1px',
          }}
        />
        
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
        >
          {showPassword ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
        </button>
      </div>
      
      {showStrength && value && (
        <div className="mt-2">
          <div className="flex gap-1 mb-1">
            {[1, 2, 3, 4, 5].map((level) => (
              <div
                key={level}
                className="flex-1 h-1 rounded-full transition-colors duration-200"
                style={{
                  backgroundColor: strength.score >= level ? strengthColors[strength.label] : theme.colors.border,
                }}
              />
            ))}
          </div>
          <p className="text-xs" style={{ color: strength.color }}>
            {strength.message}
          </p>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// OTP INPUT COMPONENT
// ============================================================================

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

const OTPInput: React.FC<OTPInputProps> = ({ length = 6, value, onChange, error }) => {
  const { theme } = useTheme();
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, char: string) => {
    if (!/^\d*$/.test(char)) return;
    const newValue = value.padEnd(length, ' ').split('');
    newValue[index] = char;
    const result = newValue.slice(0, length).join('');
    onChange(result);
    if (char && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    onChange(pastedData);
  };

  return (
    <div>
      <div className="flex justify-center gap-2" onPaste={handlePaste}>
        {Array.from({ length }, (_, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={value[i] || ''}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className="w-12 h-14 text-center text-xl font-bold rounded-lg outline-none transition-all duration-200"
            style={{
              backgroundColor: theme.colors.surface,
              color: theme.colors.text,
              borderColor: error ? theme.colors.error : theme.colors.border,
              borderWidth: '2px',
            }}
            onFocus={(e) => e.target.select()}
          />
        ))}
      </div>
      {error && <p className="mt-2 text-center text-sm" style={{ color: theme.colors.error }}>{error}</p>}
    </div>
  );
};

// ============================================================================
// BUTTON COMPONENT
// ============================================================================

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
}

const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  style,
  ...props
}) => {
  const { theme } = useTheme();

  const sizeClasses = { sm: 'px-4 py-2 text-sm', md: 'px-6 py-3 text-base', lg: 'px-8 py-4 text-lg' };
  const variantStyles: Record<string, { bg: string; color: string; border?: string }> = {
    primary: { bg: theme.colors.primary, color: 'white' },
    secondary: { bg: theme.colors.secondary, color: 'white' },
    outline: { bg: 'transparent', color: theme.colors.primary, border: `1px solid ${theme.colors.primary}` },
    ghost: { bg: 'transparent', color: theme.colors.text },
  };

  const vs = variantStyles[variant];

  return (
    <button
      disabled={disabled || loading}
      className={`font-semibold rounded-lg transition-all duration-200 inline-flex items-center justify-center gap-2 ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''}`}
      style={{
        backgroundColor: (disabled || loading) ? `${vs.bg}50` : vs.bg,
        color: vs.color,
        border: vs.border,
        cursor: (disabled || loading) ? 'not-allowed' : 'pointer',
        ...style,
      }}
      {...props}
    >
      {loading && <div className="animate-spin rounded-full h-4 w-4 border-2 border-t-transparent" style={{ borderTopColor: 'white', borderColor: 'transparent' }} />}
      {children}
    </button>
  );
};

// ============================================================================
// THEME TOGGLE
// ============================================================================

const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="fixed top-4 right-4 p-3 rounded-full shadow-lg transition-all hover:scale-110"
      style={{ backgroundColor: theme.colors.surface }}
      aria-label="Toggle theme"
    >
      {theme.mode === 'light' ? (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      ) : (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      )}
    </button>
  );
};

// ============================================================================
// MAIN LOGIN FORM
// ============================================================================

export default function LoginPage() {
  const router = useRouter();
  const { theme } = useTheme();
  
  const [credential, setCredential] = useState('');
  const [credentialDetection, setCredentialDetection] = useState<CredentialDetection>({
    type: 'unknown',
    credential: '',
    valid: false,
    normalized: '',
  });
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'credential' | 'password' | 'otp'>('credential');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [otpCode, setOtpCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);

  const handleCredentialSubmit = async () => {
    if (!credentialDetection.valid) {
      setError('Please enter a valid email or phone number');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const checkResponse = await fetch('/api/auth/check-existence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialDetection.normalized }),
      });
      const checkData = await checkResponse.json();
      if (!checkData.exists) {
        router.push(`/register?credential=${encodeURIComponent(credential)}`);
        return;
      }
      setStep('password');
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSubmit = async () => {
    if (!password) {
      setError('Please enter your password');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialDetection.normalized, password, rememberMe }),
      });
      const data: LoginResponse = await response.json();
      if (!data.success) {
        setFailedAttempts(prev => prev + 1);
        if (data.message?.includes('locked')) {
          setError(data.securityMessage || 'Account locked. Try again in 48 hours.');
          return;
        }
        if (data.requires2FA) {
          setTempToken(data.tempToken || '');
          setRequires2FA(true);
          setStep('otp');
          return;
        }
        if (data.requiresOTP) {
          setTempToken(data.tempToken || '');
          setStep('otp');
          return;
        }
        setError(data.message || 'Invalid credentials');
        if (failedAttempts >= 4) {
          setError('Account locked for 48 hours due to too many failed attempts.');
        }
        return;
      }
      if (rememberMe) {
        localStorage.setItem('tigerex_access_token', data.accessToken || '');
        localStorage.setItem('tigerex_refresh_token', data.refreshToken || '');
      } else {
        sessionStorage.setItem('tigerex_access_token', data.accessToken || '');
      }
      router.push('/dashboard');
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOTPSubmit = async () => {
    if (otpCode.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialDetection.normalized, otp: otpCode, type: requires2FA ? '2fa' : 'login', tempToken }),
      });
      const data: LoginResponse = await response.json();
      if (!data.success) {
        setError(data.message || 'Invalid code');
        return;
      }
      localStorage.setItem('tigerex_access_token', data.accessToken || '');
      localStorage.setItem('tigerex_refresh_token', data.refreshToken || '');
      router.push('/dashboard');
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ThemeProvider>
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: theme.colors.background }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md p-8 rounded-2xl shadow-xl"
          style={{ backgroundColor: theme.colors.surface }}
        >
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold" style={{ color: theme.colors.primary }}>TigerEx</h1>
            <p style={{ color: theme.colors.textSecondary }}>Welcome back</p>
          </div>

          <div className="flex justify-center gap-2 mb-6">
            {['credential', 'password', 'otp'].map((s, i) => (
              <div
                key={s}
                className="w-2 h-2 rounded-full transition-colors"
                style={{
                  backgroundColor: step === s ? theme.colors.primary : 
                    (['credential', 'password', 'otp'].indexOf(step) > i ? theme.colors.success : theme.colors.border),
                }}
              />
            ))}
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-4 p-3 rounded-lg"
                style={{ backgroundColor: `${theme.colors.error}20`, color: theme.colors.error }}
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={(e) => { e.preventDefault(); }}>
            {step === 'credential' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <label className="block mb-2 font-medium" style={{ color: theme.colors.text }}>Email or Phone Number</label>
                <UnifiedSmartInput
                  value={credential}
                  onChange={(value, detection) => { setCredential(value); setCredentialDetection(detection); setError(''); }}
                  onValidationChange={() => setError('')}
                  autoFocus
                />
                <Button onClick={handleCredentialSubmit} loading={isLoading} disabled={!credentialDetection.valid} fullWidth size="lg" className="mt-6">Continue</Button>
              </motion.div>
            )}

            {step === 'password' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <button type="button" onClick={() => setStep('credential')} className="flex items-center mb-4 text-sm" style={{ color: theme.colors.primary }}>← Back</button>
                <label className="block mb-2 font-medium" style={{ color: theme.colors.text }}>Password</label>
                <PasswordInput value={password} onChange={(value) => { setPassword(value); setError(''); }} />
                <label className="flex items-center mt-4 cursor-pointer">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="w-4 h-4 rounded" style={{ accentColor: theme.colors.primary }} />
                  <span className="ml-2 text-sm" style={{ color: theme.colors.textSecondary }}>Remember me for 30 days</span>
                </label>
                <div className="mt-4 text-right">
                  <a href="/forgot-password" className="text-sm" style={{ color: theme.colors.primary }}>Forgot Password?</a>
                </div>
                <Button onClick={handlePasswordSubmit} loading={isLoading} disabled={!password} fullWidth size="lg" className="mt-6">Login</Button>
              </motion.div>
            )}

            {step === 'otp' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <button type="button" onClick={() => setStep('password')} className="flex items-center mb-4 text-sm" style={{ color: theme.colors.primary }}>← Back</button>
                <div className="text-center mb-6">
                  <p style={{ color: theme.colors.text }}>Enter the 6-digit code {requires2FA ? '(2FA)' : 'sent to your'} {credentialDetection.type === 'email' ? 'email' : 'phone'}</p>
                </div>
                <OTPInput value={otpCode} onChange={(value) => { setOtpCode(value); setError(''); }} error={error} />
                <Button onClick={handleOTPSubmit} loading={isLoading} disabled={otpCode.length !== 6} fullWidth size="lg" className="mt-6">Verify</Button>
                <p className="mt-4 text-center text-sm" style={{ color: theme.colors.textSecondary }}>
                  Lost access? <a href="/2fa-reset" style={{ color: theme.colors.primary }}>Reset 2FA</a>
                </p>
              </motion.div>
            )}
          </form>

          {step === 'credential' && (
            <div className="mt-8">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t" style={{ borderColor: theme.colors.border }} />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2" style={{ backgroundColor: theme.colors.surface, color: theme.colors.textSecondary }}>Or continue with</span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-3">
                {[{ name: 'Google', icon: 'G' }, { name: 'Apple', icon: '🍎' }, { name: 'Telegram', icon: '✈️' }, { name: 'MetaMask', icon: '🦊' }].map((social) => (
                  <button key={social.name} type="button" className="flex items-center justify-center p-3 rounded-lg border transition-colors hover:opacity-80" style={{ borderColor: theme.colors.border }}>
                    <span className="text-lg">{social.icon}</span>
                  </button>
                ))}
              </div>
              <p className="mt-6 text-center text-sm" style={{ color: theme.colors.textSecondary }}>
                Don't have an account? <a href="/register" className="font-semibold" style={{ color: theme.colors.primary }}>Sign up</a>
              </p>
            </div>
          )}

          <p className="mt-6 text-center">
            <a href="/" className="text-sm flex items-center justify-center gap-1" style={{ color: theme.colors.textSecondary }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              Back to home
            </a>
          </p>
        </motion.div>
        <ThemeToggle />
      </div>
    </ThemeProvider>
  );
}
