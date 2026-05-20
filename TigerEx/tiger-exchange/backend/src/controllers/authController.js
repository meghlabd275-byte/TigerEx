import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import cryptoRandomString from 'crypto-random-string';
import User from '../../models/User.js';
import Session from '../../models/Session.js';
import OTP from '../../models/OTP.js';
import AuditLog from '../../models/AuditLog.js';
import RateLimit from '../../models/RateLimit.js';
import AccountChange from '../../models/AccountChange.js';
import { 
  JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN,
  OTP_LENGTH, OTP_EXPIRY_MINUTES, OTP_MAX_ATTEMPTS,
  MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_HOURS,
  JWT_COOKIE_NAME, REFRESH_COOKIE_NAME, REMEMBER_ME_DAYS
} from '../../config/constants.js';
import { sendEmail } from '../../services/email.js';
import { sendSMS } from '../../services/sms.js';
import { generateTokens, verifyRefreshToken } from '../../services/jwt.js';
import uaParser from 'ua-parser-js';
import crypto from 'crypto';

const getClientInfo = (req) => {
  const ua = uaParser(req.headers['user-agent']);
  return {
    deviceInfo: `${ua.os.name} ${ua.os.version} - ${ua.browser.name}`,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent']
  };
};

export const register = async (req, res) => {
  try {
    const { identifier, password, referralCode, countryCode } = req.body;
    
    const normalized = User.normalizeIdentifier(identifier);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid email or phone number' });
    }

    const isEmail = normalized.type === 'email';
    const existingUser = await User.findByEmailOrPhone(identifier);
    
    if (existingUser) {
      return res.status(409).json({ error: isEmail ? 'Email already registered' : 'Phone already registered' });
    }

    if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.value)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!isEmail && !/^\+?[1-9]\d{1,14}$/.test(normalized.value)) {
      return res.status(400).json({ error: 'Invalid phone format' });
    }

    const user = new User({
      [isEmail ? 'email' : 'phone']: normalized.value,
      password,
      phoneCountryCode: countryCode,
      referralCode: referralCode ? referralCode.trim().toUpperCase() : undefined
    });

    if (referralCode) {
      const referrer = await User.findOne({ referralCode: referralCode.trim().toUpperCase() });
      if (referrer) user.referredBy = referrer._id;
    }

    await user.save();

    const code = user.generateOTP();
    await OTP.create({
      identifier: normalized.value,
      type: isEmail ? 'email' : 'phone',
      code,
      userId: user._id,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      ip: req.ip
    });

    if (isEmail) {
      await sendEmail(normalized.value, 'Verify your email', { code }, 'verification');
    } else {
      await sendSMS(normalized.value, `Your ${process.env.APP_NAME || 'TigerEx'} verification code is: ${code}`);
    }

    await AuditLog.create({
      userId: user._id,
      action: 'register',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      status: 'success'
    });

    res.status(201).json({ 
      message: 'Registration successful. Please verify your account.',
      userId: user._id
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

export const login = async (req, res) => {
  try {
    const { identifier, password, rememberMe } = req.body;
    const clientInfo = getClientInfo(req);

    const normalized = User.normalizeIdentifier(identifier);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid email or phone format' });
    }

    const rateLimitKey = `login:${normalized.value}`;
    const rateLimit = await RateLimit.findOne({ identifier: rateLimitKey, type: 'login' });
    
    if (rateLimit?.blockedUntil && new Date(rateLimit.blockedUntil) > new Date()) {
      return res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
    }

    const user = await User.findByEmailOrPhone(identifier);
    
    if (!user) {
      await RateLimit.findOneAndUpdate(
        { identifier: rateLimitKey, type: 'login' },
        { 
          $inc: { attempts: 1 },
          $set: { lastAttemptAt: new Date(), type: 'login' }
        },
        { upsert: true }
      );
      
      await AuditLog.create({
        action: 'login_failed',
        ip: clientInfo.ip,
        userAgent: clientInfo.userAgent,
        metadata: { identifier: normalized.value, reason: 'User not found' },
        status: 'failed'
      });

      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active', code: 'ACCOUNT_NOT_ACTIVE' });
    }

    const isLocked = user.lockedUntil && new Date(user.lockedUntil) > new Date();
    if (isLocked) {
      return res.status(423).json({ 
        error: 'Account is locked due to too many failed attempts',
        lockedUntil: user.lockedUntil,
        code: 'ACCOUNT_LOCKED'
      });
    }

    const passwordMatch = await user.comparePassword(password);
    
    if (!passwordMatch) {
      const newAttempts = (user.loginAttempts || 0) + 1;
      
      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        user.loginAttempts = 0;
        user.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_HOURS * 60 * 60 * 1000);
        await user.save();

        await RateLimit.findOneAndUpdate(
          { identifier: rateLimitKey, type: 'login' },
          { 
            blockedUntil: user.lockedUntil,
            attempts: newAttempts,
            lastAttemptAt: new Date()
          },
          { upsert: true }
        );

        await AuditLog.create({
          userId: user._id,
          action: 'login_failed',
          ip: clientInfo.ip,
          userAgent: clientInfo.userAgent,
          reason: 'Account locked due to too many failed attempts',
          status: 'blocked'
        });

        return res.status(423).json({
          error: 'Too many failed attempts. Account locked for 48 hours.',
          code: 'ACCOUNT_LOCKED'
        });
      }

      user.loginAttempts = newAttempts;
      await user.save();

      await RateLimit.findOneAndUpdate(
        { identifier: rateLimitKey, type: 'login' },
        { $inc: { attempts: 1 }, lastAttemptAt: new Date() },
        { upsert: true }
      );

      await AuditLog.create({
        userId: user._id,
        action: 'login_failed',
        ip: clientInfo.ip,
        userAgent: clientInfo.userAgent,
        metadata: { incorrectPassword: true },
        status: 'failed'
      });

      res.status(401).json({ 
        error: 'Invalid password',
        attemptsRemaining: MAX_LOGIN_ATTEMPTS - newAttempts
      });
      return;
    }

    user.loginAttempts = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = new Date();
    user.lastLoginIP = clientInfo.ip;
    user.lastLoginUA = clientInfo.userAgent;
    await user.save();

    await AuditLog.create({
      userId: user._id,
      action: 'login',
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      status: 'success'
    });

    const requires2FA = user.twoFactorAuth?.enabled;
    if (requires2FA) {
      return res.json({
        requires2FA: true,
        userId: user._id
      });
    }

    const { accessToken, refreshToken, expiresIn } = generateTokens(user);
    const sessionExpiry = rememberMe 
      ? new Date(Date.now() + REMEMBER_ME_DAYS * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const session = await Session.create({
      userId: user._id,
      token: accessToken,
      refreshToken,
      expiresAt: sessionExpiry,
      ...clientInfo,
      user: {
        email: user.email,
        phone: user.phone,
        role: user.role,
        twoFactorEnabled: user.twoFactorAuth?.enabled
      }
    });

    if (rememberMe) {
      res.cookie(JWT_COOKIE_NAME, accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: REMEMBER_ME_DAYS * 24 * 60 * 60 * 1000
      });
    } else {
      res.cookie(JWT_COOKIE_NAME, accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });
    }

    res.json({
      accessToken,
      refreshToken,
      expiresIn,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        profile: user.profile,
        role: user.role,
        kyc: user.kyc,
        preferences: user.preferences
      },
      rememberMe
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

export const verify2FA = async (req, res) => {
  try {
    const { userId, code, rememberMe } = req.body;
    const clientInfo = getClientInfo(req);

    const user = await User.findById(userId);
    if (!user || user.status !== 'active') {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = speakeasy.totp.verify({
      secret: user.twoFactorAuth.secret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!isValid) {
      const otpRecord = await OTP.findOneAndUpdate(
        { userId: user._id, type: '2fa', verified: false },
        { $inc: { attempts: 1 } },
        { new: true }
      );
      
      if (otpRecord && otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
        return res.status(400).json({ error: 'Too many incorrect attempts' });
      }

      return res.status(400).json({ error: 'Invalid verification code' });
    }

    await OTP.updateMany({ userId: user._id, type: '2fa' }, { verified: true });

    const { accessToken, refreshToken, expiresIn } = generateTokens(user);
    const sessionExpiry = rememberMe 
      ? new Date(Date.now() + REMEMBER_ME_DAYS * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const session = await Session.create({
      userId: user._id,
      token: accessToken,
      refreshToken,
      expiresAt: sessionExpiry,
      ...clientInfo,
      user: {
        email: user.email,
        phone: user.phone,
        role: user.role,
        twoFactorEnabled: user.twoFactorAuth?.enabled
      }
    });

    res.cookie(JWT_COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: rememberMe ? REMEMBER_ME_DAYS * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
    });

    res.json({
      accessToken,
      refreshToken,
      expiresIn,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        profile: user.profile,
        role: user.role,
        kyc: user.kyc
      }
    });
  } catch (error) {
    console.error('2FA verify error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
};

export const sendVerificationCode = async (req, res) => {
  try {
    const { identifier, type } = req.body;
    
    const normalized = User.normalizeIdentifier(identifier);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid identifier' });
    }

    const user = await User.findByEmailOrPhone(identifier);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (normalized.type === 'email' && !user.email) {
      return res.status(400).json({ error: 'No email associated with account' });
    }
    if (normalized.type === 'phone' && !user.phone) {
      return res.status(400).json({ error: 'No phone associated with account' });
    }

    const recentOTP = await OTP.findOne({
      identifier: normalized.value,
      type: normalized.type,
      verified: false,
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 });

    if (recentOTP) {
      const waitTime = Math.ceil((new Date(recentOTP.expiresAt).getTime() - Date.now()) / 1000);
      if (waitTime > OTP_EXPIRY_MINUTES * 60 * 30) {
        return res.status(429).json({ error: 'Please wait before requesting another code' });
      }
    }

    const code = user.generateOTP();
    await OTP.create({
      identifier: normalized.value,
      type: normalized.type,
      code,
      userId: user._id,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      ip: req.ip
    });

    if (normalized.type === 'email') {
      await sendEmail(normalized.value, 'Verification Code', { code }, 'verification');
    } else {
      await sendSMS(normalized.value, `Your verification code is: ${code}`);
    }

    res.json({ message: 'Verification code sent' });
  } catch (error) {
    console.error('Send verification error:', error);
    res.status(500).json({ error: 'Failed to send code' });
  }
};

export const verifyCode = async (req, res) => {
  try {
    const { identifier, code, type } = req.body;
    
    const normalized = User.normalizeIdentifier(identifier);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid identifier' });
    }

    const otpRecord = await OTP.findOne({
      identifier: normalized.value,
      type: normalized.type,
      verified: false
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(404).json({ error: 'No pending verification' });
    }

    if (new Date(otpRecord.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Code expired' });
    }

    if (otpRecord.code !== code && otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(400).json({ error: 'Too many attempts' });
    }

    if (otpRecord.code !== code) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      return res.status(400).json({ error: 'Invalid code' });
    }

    otpRecord.verified = true;
    await otpRecord.save();

    const user = await User.findById(otpRecord.userId);
    if (user) {
      if (normalized.type === 'email') {
        user.emailVerified = true;
        await user.save();
      } else if (normalized.type === 'phone') {
        user.phoneVerified = true;
        await user.save();
      }
    }

    res.json({ verified: true });
  } catch (error) {
    console.error('Verify code error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { identifier, code, newPassword } = req.body;
    
    const normalized = User.normalizeIdentifier(identifier);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid identifier' });
    }

    const user = await User.findByEmailOrPhone(identifier);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const otpRecord = await OTP.findOne({
      $or: [
        { identifier: normalized.value, type: 'password_reset' },
        { identifier: normalized.value, type: 'email' },
        { identifier: normalized.value, type: 'phone' }
      ],
      verified: true,
      userId: user._id
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(400).json({ error: 'Identity not verified' });
    }

    user.password = newPassword;
    await user.save();

    await OTP.deleteMany({ userId: user._id, type: 'password_reset' });
    
    await AuditLog.create({
      userId: user._id,
      action: 'password_change',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { method: 'reset' },
      status: 'success'
    });

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
};

export const setup2FA = async (req, res) => {
  try {
    const userId = req.user.id;
    const { method, phone } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.emailVerified && !user.phoneVerified) {
      return res.status(400).json({ error: 'Verify email or phone first' });
    }

    const secret = speakeasy.generateSecret({
      name: `TigerEx:${user.email || user.phone}`
    });

    let qrCodeUrl;
    if (method === 'totp') {
      qrCodeUrl = await QRCode.toDataURL(
        `otpauth://totp/${encodeURIComponent('TigerEx')}:${encodeURIComponent(user.email || user.phone)}?secret=${secret.base32}&issuer=TigerEx`
      );
    }

    user.twoFactorAuth = {
      enabled: false,
      secret: secret.base32,
      method,
      phoneLast4: phone ? phone.slice(-4) : undefined,
      backupCodes: Array.from({ length: 8 }, () => cryptoRandomString({ length: 8, type: 'alphanumeric' }))
    };
    await user.save();

    if (method === 'sms' && phone) {
      const code = user.generateOTP();
      await OTP.create({
        identifier: phone,
        type: '2fa_setup',
        code,
        userId: user._id,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)
      });
      await sendSMS(phone, `Your ${process.env.APP_NAME} 2FA code: ${code}`);
    }

    res.json({
      secret: method === 'totp' ? secret.base32 : undefined,
      qrCodeUrl,
      backupCodes: user.twoFactorAuth.backupCodes,
      message: 'Verify the code to enable 2FA'
    });
  } catch (error) {
    console.error('Setup 2FA error:', error);
    res.status(500).json({ error: 'Failed to setup 2FA' });
  }
};

export const confirm2FA = async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;

    const user = await User.findById(userId);
    if (!user || !user.twoFactorAuth?.secret) {
      return res.status(404).json({ error: '2FA not setup' });
    }

    const isValid = speakeasy.totp.verify({
      secret: user.twoFactorAuth.secret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    user.twoFactorAuth.enabled = true;
    await user.save();

    await AuditLog.create({
      userId: user._id,
      action: '2fa_enable',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      status: 'success'
    });

    res.json({ message: '2FA enabled successfully' });
  } catch (error) {
    console.error('Confirm 2FA error:', error);
    res.status(500).json({ error: 'Failed to confirm 2FA' });
  }
};

export const reset2FA = async (req, res) => {
  try {
    const { identifier, emailCode, phoneCode, livenessData, faceDescriptor } = req.body;
    
    const normalized = User.normalizeIdentifier(identifier);
    const user = await User.findByEmailOrPhone(identifier);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isVerified = await OTP.findOne({
      identifier: normalized.value,
      code: emailCode,
      type: 'email',
      verified: true,
      userId: user._id
    });

    const phoneVerified = user.phone ? await OTP.findOne({
      identifier: user.phone,
      code: phoneCode,
      type: 'phone',
      verified: true,
      userId: user._id
    }) : true;

    if (!isVerified || !phoneVerified) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    user.twoFactorAuth = {
      enabled: false,
      secret: null,
      backupCodes: [],
      method: 'totp'
    };
    await user.save();

    await AuditLog.create({
      userId: user._id,
      action: '2fa_reset',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      status: 'success'
    });

    res.json({ message: '2FA reset. Please setup new 2FA.' });
  } catch (error) {
    console.error('Reset 2FA error:', error);
    res.status(500).json({ error: 'Failed to reset 2FA' });
  }
};

export const logout = async (req, res) => {
  try {
    const token = req.cookies[JWT_COOKIE_NAME] || req.headers.authorization?.split(' ')[1];
    
    if (token) {
      await Session.findOneAndDelete({ token });
    }
    
    res.clearCookie(JWT_COOKIE_NAME);
    res.json({ message: 'Logged out' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
};

export const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const decoded = verifyRefreshToken(token);
    const session = await Session.findOne({ refreshToken: token, userId: decoded.id });
    
    if (!session || new Date(session.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = await User.findById(decoded.id);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'User not active' });
    }

    const { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn } = generateTokens(user);
    
    session.token = newAccessToken;
    session.refreshToken = newRefreshToken;
    await session.save();

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
};

export const socialLogin = async (req, res) => {
  try {
    const { provider, accessToken } = req.body;
    const clientInfo = getClientInfo(req);

    let userData;
    
    if (provider === 'google') {
      const { OAuth2Client } = await import('google-auth-library');
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({ idToken: accessToken });
      userData = ticket.getPayload();
    }

    if (!userData) {
      return res.status(400).json({ error: 'Invalid social token' });
    }

    let user = await User.findOne({ 
      $or: [
        { 'oauth.google.email': userData.email },
        { email: userData.email }
      ] 
    });

    if (!user) {
      user = new User({
        email: userData.email,
        profile: {
          firstName: userData.given_name,
          lastName: userData.family_name
        },
        emailVerified: true,
        oauth: {
          google: {
            id: userData.sub,
            email: userData.email
          }
        }
      });
      await user.save();
    }

    const { accessToken: token, refreshToken, expiresIn } = generateTokens(user);
    
    const session = await Session.create({
      userId: user._id,
      token,
      refreshToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...clientInfo,
      user: {
        email: user.email,
        role: user.role,
        twoFactorEnabled: user.twoFactorAuth?.enabled
      }
    });

    res.cookie(JWT_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      accessToken: token,
      refreshToken,
      expiresIn,
      user: {
        id: user._id,
        email: user.email,
        profile: user.profile,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Social login error:', error);
    res.status(500).json({ error: 'Social login failed' });
  }
};

export const metamaskConnect = async (req, res) => {
  try {
    const { address, signature, nonce } = req.body;

    const user = await User.findOne({ 'oauth.metamask.address': address.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({ error: 'Wallet not connected' });
    }

    if (!user.oauth.metamask.nonce || user.oauth.metamask.nonce !== nonce) {
      return res.status(400).json({ error: 'Invalid nonce' });
    }

    user.oauth.metamask.nonce = cryptoRandomString({ length: 20 });
    await user.save();

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account not active' });
    }

    const { accessToken, refreshToken, expiresIn } = generateTokens(user);
    const clientInfo = getClientInfo(req);

    const session = await Session.create({
      userId: user._id,
      token: accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...clientInfo,
      user: {
        email: user.email || undefined,
        phone: user.phone || undefined,
        role: user.role
      }
    });

    res.json({
      accessToken,
      refreshToken,
      expiresIn,
      user: {
        id: user._id,
        email: user.email,
        profile: user.profile,
        role: user.role,
        withdrawEnabled: user.withdrawalsEnabled
      }
    });
  } catch (error) {
    console.error('Metamask connect error:', error);
    res.status(500).json({ error: 'Connection failed' });
  }
};

export const changeField = async (req, res) => {
  try {
    const userId = req.user.id;
    const { field, newValue, code, type } = req.body;
    const normalized = User.normalizeIdentifier(newValue || '');
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    if (field === 'email' || field === 'phone') {
      const existing = await User.findByEmailOrPhone(normalized.value);
      if (existing) {
        return res.status(409).json({ error: 'Already in use' });
      }
    }

    const change = new AccountChange({
      userId: user._id,
      type: field,
      oldValue: user[field],
      newValue: newValue,
      status: 'pending'
    });

    if (code) {
      const isVerified = await OTP.findOne({
        identifier: newValue,
        code,
        type: normalized?.type || field,
        verified: true,
        userId: user._id
      });
      if (!isVerified) return res.status(400).json({ error: 'Invalid code' });
      change.verificationData.emailCode = code;
      change.verificationData.verifiedAt = new Date();
    }

    await change.save();
    res.json({ message: 'Verification pending', changeId: change._id });
  } catch (error) {
    console.error('Change field error:', error);
    res.status(500).json({ error: 'Change failed' });
  }
};

export const confirmChange = async (req, res) => {
  try {
    const userId = req.user.id;
    const { changeId, livenessVerified } = req.body;
    const user = await User.findById(userId);

    const change = await AccountChange.findOne({ _id: changeId, userId });
    if (!change || change.status !== 'pending') {
      return res.status(400).json({ error: 'Invalid change request' });
    }

    if (change.verificationData?.verifiedAt && livenessVerified) {
      change.verificationData.livenessVerified = true;
      change.verificationData.verifiedAt = new Date();
    }

    if (change.type === 'email') {
      user.email = change.newValue;
      user.emailVerified = false;
    } else if (change.type === 'phone') {
      user.phone = change.newValue;
      user.phoneVerified = false;
    }

    change.status = 'completed';
    change.completedAt = new Date();
    
    await user.save();
    await change.save();

    user.withdrawalLockUntil = new Date(Date.now() + 48 * 60 * 60 * 1000);
    user.withdrawalsEnabled = false;
    await user.save();

    res.json({ message: `${change.type} changed successfully` });
  } catch (error) {
    console.error('Confirm change error:', error);
    res.status(500).json({ error: 'Confirmation failed' });
  }
};

export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const { emailCode, phoneCode, confirmText } = req.body;
    const user = await User.findById(userId);

    if (confirmText !== 'DELETE MY ACCOUNT') {
      return res.status(400).json({ error: 'Confirmation text mismatch' });
    }

    const emailVerified = user.email ? await OTP.findOne({
      identifier: user.email, code: email_code, type: 'email', verified: true, userId
    }) : true;

    const phoneVerified = user.phone ? await OTP.findOne({
      identifier: user.phone, code: phoneCode, type: 'phone', verified: true, userId
    }) : true;

    if (!emailVerified || !phoneVerified) {
      return res.status(400).json({ error: 'Verification required' });
    }

    user.status = 'deleted';
    user.deletedAt = new Date();
    await user.save();

    await AuditLog.create({
      userId: user._id,
      action: 'account_delete',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      status: 'success'
    });

    res.json({ message: 'Account deletion scheduled. You have 30 days to cancel.' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Deletion failed' });
  }
};

export const getCountries = async (req, res) => {
  const countries = require('../../config/countries.js');
  res.json(countries);
};

export const checkRegistration = async (req, res) => {
  try {
    const { identifier } = req.body;
    const normalized = User.normalizeIdentifier(identifier);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid format' });
    }
    const exists = await User.findByEmailOrPhone(normalized.value);
    res.json({ registered: !!exists });
  } catch (error) {
    res.status(500).json({ error: 'Check failed' });
  }
};