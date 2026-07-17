"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface User {
  id: string;
  email: string;
  phone?: string;
  username: string;
  kycLevel: number;
  status: 'active' | 'suspended' | 'pending';
  twoFactorEnabled: boolean;
  createdAt: string;
  verifiedAt?: string;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (emailOrPhone: string, password: string, twoFactorCode?: string) => Promise<{ success: boolean; error?: string; requiresTwoFactor?: boolean }>;
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  updateUser: (user: Partial<User>) => void;
  verifyEmail: (code: string) => Promise<{ success: boolean; error?: string }>;
  verifyPhone: (code: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (emailOrPhone: string, code: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  enableTwoFactor: () => Promise<{ success: boolean; secret?: string; error?: string }>;
  disableTwoFactor: (code: string) => Promise<{ success: boolean; error?: string }>;
}

interface RegisterData {
  emailOrPhone: string;
  password: string;
  referralCode?: string;
  agreeToTerms: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_BASE = '/api/auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // Load stored tokens on mount
  useEffect(() => {
    const loadStoredAuth = async () => {
      try {
        const storedToken = localStorage.getItem('tigerex_access_token');
        const storedRefreshToken = localStorage.getItem('tigerex_refresh_token');
        
        if (storedToken) {
          // Verify token is still valid
          const response = await fetch(`${API_BASE}/me`, {
            headers: {
              Authorization: `Bearer ${storedToken}`,
            },
          });
          
          if (response.ok) {
            const userData = await response.json();
            setState({
              user: userData,
              accessToken: storedToken,
              refreshToken: storedRefreshToken,
              isAuthenticated: true,
              isLoading: false,
            });
            return;
          }
        }
        
        // Token invalid or not found
        localStorage.removeItem('tigerex_access_token');
        localStorage.removeItem('tigerex_refresh_token');
        setState(prev => ({ ...prev, isLoading: false }));
      } catch (error) {
        console.error('Failed to load stored auth:', error);
        setState(prev => ({ ...prev, isLoading: false }));
      }
    };
    
    loadStoredAuth();
  }, []);

  const login = useCallback(async (
    emailOrPhone: string, 
    password: string, 
    twoFactorCode?: string
  ): Promise<{ success: boolean; error?: string; requiresTwoFactor?: boolean }> => {
    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone, 
          password,
          twoFactorCode,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error?.message || 'Login failed' };
      }

      if (data.requiresTwoFactor) {
        return { success: true, requiresTwoFactor: true };
      }

      // Store tokens
      localStorage.setItem('tigerex_access_token', data.accessToken);
      if (data.refreshToken) {
        localStorage.setItem('tigerex_refresh_token', data.refreshToken);
      }

      // Get user data
      const userResponse = await fetch(`${API_BASE}/me`, {
        headers: { Authorization: `Bearer ${data.accessToken}` },
      });
      const userData = await userResponse.json();

      setState({
        user: userData,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        isAuthenticated: true,
        isLoading: false,
      });

      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, []);

  const register = useCallback(async (data: RegisterData): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        return { success: false, error: result.error?.message || 'Registration failed' };
      }

      return { success: true };
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const token = localStorage.getItem('tigerex_access_token');
      if (token) {
        await fetch(`${API_BASE}/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('tigerex_access_token');
      localStorage.removeItem('tigerex_refresh_token');
      setState({
        user: null,
        accessToken: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    const refreshToken = localStorage.getItem('tigerex_refresh_token');
    if (!refreshToken) {
      logout();
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        logout();
        return;
      }

      const data = await response.json();
      localStorage.setItem('tigerex_access_token', data.accessToken);
      if (data.refreshToken) {
        localStorage.setItem('tigerex_refresh_token', data.refreshToken);
      }

      setState(prev => ({
        ...prev,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      }));
    } catch (error) {
      console.error('Token refresh error:', error);
      logout();
    }
  }, [logout]);

  const updateUser = useCallback((userData: Partial<User>) => {
    setState(prev => ({
      ...prev,
      user: prev.user ? { ...prev.user, ...userData } : null,
    }));
  }, []);

  const verifyEmail = useCallback(async (code: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = localStorage.getItem('tigerex_access_token');
      const response = await fetch(`${API_BASE}/verify-email`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        return { success: false, error: data.error?.message || 'Verification failed' };
      }

      if (state.user) {
        updateUser({ verifiedAt: new Date().toISOString() });
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, [state.user, updateUser]);

  const verifyPhone = useCallback(async (code: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = localStorage.getItem('tigerex_access_token');
      const response = await fetch(`${API_BASE}/verify-phone`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        return { success: false, error: data.error?.message || 'Verification failed' };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, []);

  const resetPassword = useCallback(async (
    emailOrPhone: string, 
    code: string, 
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`${API_BASE}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrPhone, code, newPassword }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        return { success: false, error: data.error?.message || 'Password reset failed' };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, []);

  const enableTwoFactor = useCallback(async (): Promise<{ success: boolean; secret?: string; error?: string }> => {
    try {
      const token = localStorage.getItem('tigerex_access_token');
      const response = await fetch(`${API_BASE}/2fa/enable`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const data = await response.json();
      
      if (!response.ok) {
        return { success: false, error: data.error?.message || 'Failed to enable 2FA' };
      }

      return { success: true, secret: data.secret };
    } catch (error) {
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, []);

  const disableTwoFactor = useCallback(async (code: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = localStorage.getItem('tigerex_access_token');
      const response = await fetch(`${API_BASE}/2fa/disable`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        return { success: false, error: data.error?.message || 'Failed to disable 2FA' };
      }

      if (state.user) {
        updateUser({ twoFactorEnabled: false });
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, [state.user, updateUser]);

  const value: AuthContextType = {
    ...state,
    login,
    register,
    logout,
    refreshAuth,
    updateUser,
    verifyEmail,
    verifyPhone,
    resetPassword,
    enableTwoFactor,
    disableTwoFactor,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
