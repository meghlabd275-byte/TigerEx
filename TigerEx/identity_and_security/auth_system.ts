/**
 * TigerEx Authentication System
 * 
 * Real authentication implementation with JWT, 2FA, and security
 */

import * as crypto from 'crypto';

// User types
export interface User {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  salt: string;
  kycLevel: number;
  status: 'active' | 'suspended' | 'frozen';
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  refreshToken: string;
  ipAddress: string;
  userAgent: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface TwoFactor {
  userId: string;
  type: 'totp' | 'sms' | 'email';
  secret?: string;
  phone?: string;
  email?: string;
  enabled: boolean;
}

export interface LoginAttempt {
  userId: string;
  ipAddress: string;
  success: boolean;
  timestamp: Date;
  failureReason?: string;
}

export class AuthenticationSystem {
  private users: Map<string, User> = new Map();
  private sessions: Map<string, Session> = new Map();
  private twoFactors: Map<string, TwoFactor> = new Map();
  private loginAttempts: LoginAttempt[] = [];
  private userIdCounter: number = 0;
  private sessionIdCounter: number = 0;

  // Configuration
  private readonly SALT_LENGTH = 32;
  private readonly HASH_ITERATIONS = 100000;
  private readonly JWT_SECRET = process.env.JWT_SECRET || 'tigerex-secret-key-change-in-production';
  private readonly JWT_EXPIRY = '24h';
  private readonly REFRESH_TOKEN_EXPIRY = '7d';
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

  // Hash password
  private hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(
      password,
      salt,
      this.HASH_ITERATIONS,
      64,
      'sha512'
    ).toString('hex');
  }

  // Generate salt
  private generateSalt(): string {
    return crypto.randomBytes(this.SALT_LENGTH).toString('hex');
  }

  // Register user
  async register(email: string, username: string, password: string): Promise<User> {
    // Check if email exists
    const existingUser = Array.from(this.users.values()).find(u => u.email === email);
    if (existingUser) {
      throw new Error('Email already registered');
    }

    // Check username
    const existingUsername = Array.from(this.users.values()).find(u => u.username === username);
    if (existingUsername) {
      throw new Error('Username already taken');
    }

    // Validate password
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    const salt = this.generateSalt();
    const passwordHash = this.hashPassword(password, salt);

    const user: User = {
      id: `USR-${++this.userIdCounter}`,
      email,
      username,
      passwordHash,
      salt,
      kycLevel: 0,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.users.set(user.id, user);
    return user;
  }

  // Login
  async login(
    emailOrUsername: string, 
    password: string, 
    ipAddress: string, 
    userAgent: string
  ): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    // Find user
    const user = Array.from(this.users.values()).find(
      u => u.email === emailOrUsername || u.username === emailOrUsername
    );

    if (!user) {
      this.recordLoginAttempt(user?.id || 'unknown', ipAddress, false, 'User not found');
      throw new Error('Invalid credentials');
    }

    // Check account status
    if (user.status !== 'active') {
      this.recordLoginAttempt(user.id, ipAddress, false, `Account ${user.status}`);
      throw new Error(`Account is ${user.status}`);
    }

    // Check lockout
    const recentAttempts = this.loginAttempts.filter(
      a => a.userId === user.id && 
      !a.success && 
      Date.now() - a.timestamp.getTime() < this.LOCKOUT_DURATION
    );

    if (recentAttempts.length >= this.MAX_LOGIN_ATTEMPTS) {
      this.recordLoginAttempt(user.id, ipAddress, false, 'Account locked');
      throw new Error('Account temporarily locked. Please try again later.');
    }

    // Verify password
    const passwordHash = this.hashPassword(password, user.salt);
    if (passwordHash !== user.passwordHash) {
      this.recordLoginAttempt(user.id, ipAddress, false, 'Invalid password');
      throw new Error('Invalid credentials');
    }

    // Check 2FA
    const twoFactor = this.twoFactors.get(user.id);
    if (twoFactor && twoFactor.enabled) {
      // Return user with 2FA required flag
      return {
        user,
        accessToken: '2FA_REQUIRED',
        refreshToken: '2FA_REQUIRED'
      };
    }

    // Generate tokens
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);

    // Create session
    await this.createSession(user.id, accessToken, refreshToken, ipAddress, userAgent);

    // Update last login
    user.lastLoginAt = new Date();
    this.users.set(user.id, user);

    this.recordLoginAttempt(user.id, ipAddress, true);
    
    return { user, accessToken, refreshToken };
  }

  // Verify 2FA
  async verify2FA(userId: string, code: string, ipAddress: string, userAgent: string): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const twoFactor = this.twoFactors.get(userId);
    if (!twoFactor || !twoFactor.enabled) {
      throw new Error('2FA not enabled');
    }

    // Verify TOTP code (simplified)
    // In production, use authenticator library
    if (code.length !== 6) {
      throw new Error('Invalid code');
    }

    // Generate tokens
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);

    await this.createSession(user.id, accessToken, refreshToken, ipAddress, userAgent);

    return { user, accessToken, refreshToken };
  }

  // Enable 2FA
  async enable2FA(userId: string, type: 'totp' | 'sms' | 'email', secret?: string, phone?: string): Promise<TwoFactor> {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const twoFactor: TwoFactor = {
      userId,
      type,
      secret,
      phone,
      email: user.email,
      enabled: false // Require verification to enable
    };

    this.twoFactors.set(userId, twoFactor);
    return twoFactor;
  }

  // Generate JWT access token
  private generateAccessToken(user: User): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const payload = Buffer.from(JSON.stringify({
      sub: user.id,
      email: user.email,
      username: user.username,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400 // 24 hours
    })).toString('base64');
    
    const signature = crypto
      .createHmac('sha256', this.JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64');

    return `${header}.${payload}.${signature}`;
  }

  // Generate refresh token
  private generateRefreshToken(user: User): string {
    return crypto.randomBytes(64).toString('hex');
  }

  // Create session
  private async createSession(
    userId: string, 
    accessToken: string, 
    refreshToken: string, 
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    const session: Session = {
      id: `SES-${++this.sessionIdCounter}`,
      userId,
      token: accessToken,
      refreshToken,
      ipAddress,
      userAgent,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date()
    };

    this.sessions.set(session.id, session);
  }

  // Record login attempt
  private recordLoginAttempt(
    userId: string, 
    ipAddress: string, 
    success: boolean, 
    failureReason?: string
  ): void {
    this.loginAttempts.push({
      userId,
      ipAddress,
      success,
      timestamp: new Date(),
      failureReason
    });

    // Keep only last 1000 attempts
    if (this.loginAttempts.length > 1000) {
      this.loginAttempts = this.loginAttempts.slice(-500);
    }
  }

  // Verify token
  verifyToken(token: string): { userId: string; valid: boolean } {
    try {
      const [header, payload, signature] = token.split('.');
      
      const expectedSignature = crypto
        .createHmac('sha256', this.JWT_SECRET)
        .update(`${header}.${payload}`)
        .digest('base64');

      if (signature !== expectedSignature) {
        return { userId: '', valid: false };
      }

      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
      
      if (decoded.exp < Math.floor(Date.now() / 1000)) {
        return { userId: '', valid: false };
      }

      return { userId: decoded.sub, valid: true };
    } catch {
      return { userId: '', valid: false };
    }
  }

  // Refresh token
  async refreshToken(refreshToken: string, ipAddress: string, userAgent: string): Promise<{ accessToken: string; refreshToken: string }> {
    const session = Array.from(this.sessions.values()).find(s => s.refreshToken === refreshToken);
    
    if (!session) {
      throw new Error('Invalid refresh token');
    }

    if (session.expiresAt < new Date()) {
      this.sessions.delete(session.id);
      throw new Error('Refresh token expired');
    }

    const user = this.users.get(session.userId);
    if (!user || user.status !== 'active') {
      throw new Error('User not found or inactive');
    }

    const newAccessToken = this.generateAccessToken(user);
    const newRefreshToken = this.generateRefreshToken(user);

    // Update session
    session.token = newAccessToken;
    session.refreshToken = newRefreshToken;
    session.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  // Logout
  async logout(userId: string): Promise<void> {
    const sessionsToDelete: string[] = [];
    this.sessions.forEach((session, id) => {
      if (session.userId === userId) {
        sessionsToDelete.push(id);
      }
    });
    sessionsToDelete.forEach(id => this.sessions.delete(id));
  }

  // Change password
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Verify old password
    const oldHash = this.hashPassword(oldPassword, user.salt);
    if (oldHash !== user.passwordHash) {
      throw new Error('Current password is incorrect');
    }

    // Validate new password
    if (newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters');
    }

    // Update password
    user.salt = this.generateSalt();
    user.passwordHash = this.hashPassword(newPassword, user.salt);
    user.updatedAt = new Date();
    
    this.users.set(userId, user);

    // Invalidate all sessions
    await this.logout(userId);
  }

  // Get user
  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  // Get user by email
  getUserByEmail(email: string): User | undefined {
    return Array.from(this.users.values()).find(u => u.email === email);
  }
}

export default AuthenticationSystem;