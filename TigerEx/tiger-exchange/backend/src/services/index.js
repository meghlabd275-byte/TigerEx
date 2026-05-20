import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const templates = {
  verification: (code) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>TigerEx Email Verification</h2>
      <p>Your verification code is:</p>
      <h1 style="background: #f0f0f0; padding: 20px; text-align: center; letter-spacing: 5px;">${code}</h1>
      <p>This code expires in 5 minutes.</p>
    </div>`,
  
  passwordReset: (code) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>TigerEx Password Reset</h2>
      <p>Your password reset code is:</p>
      <h1 style="background: #f0f0f0; padding: 20px; text-align: center; letter-spacing: 5px;">${code}</h1>
      <p>If you didn't request this, please ignore this email.</p>
    </div>`,
  
  welcome: (user) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Welcome to TigerEx, ${user.profile?.firstName || 'Trader'}!</h2>
      <p>Your account has been created successfully.</p>
      <p>Verify your email to get started.</p>
    </div>`
};

export const sendEmail = async (to, subject, data, template) => {
  try {
    if (process.env.NODE_ENV === 'test') return true;
    
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@tigerex.io',
      to,
      subject,
      html: templates[template]?.(data.code) || data.html || ''
    });
    return true;
  } catch (err) {
    console.error('Email send error:', err);
    return false;
  }
};

export default { sendEmail };
--------------------------------------------------------

import twilio from 'twilio';

const client = process.env.TWILIO_ACCOUNT_SID 
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

export const sendSMS = async (to, message) => {
  try {
    if (!client || process.env.NODE_ENV === 'test') {
      console.log(`[SMS] To: ${to}, Message: ${message}`);
      return true;
    }

    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to
    });
    return true;
  } catch (err) {
    console.error('SMS send error:', err);
    return false;
  }
};

export default { sendSMS };
--------------------------------------------------------

import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN } from '../config/constants.js';

export const generateTokens = (user) => {
  const payload = {
    id: user._id,
    email: user.email,
    phone: user.phone,
    role: user.role
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = jwt.sign({ id: user._id, type: 'refresh' }, JWT_SECRET, { 
    expiresIn: JWT_REFRESH_EXPIRES_IN 
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: 15 * 60
  };
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

export default { generateTokens, verifyRefreshToken };
--------------------------------------------------------

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export const encrypt = (text) => {
  const key = crypto.scryptSync(process.env.ENCRYPTION_KEY || 'default-key', 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
};

export const decrypt = (encrypted) => {
  const key = crypto.scryptSync(process.env.ENCRYPTION_KEY || 'default-key', 'salt', 32);
  const [ivHex, authTagHex, encryptedData] = encrypted.split(':');
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

export default { encrypt, decrypt };
--------------------------------------------------------

export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: Object.values(err.errors).map(e => e.message)
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  if (err.code === 11000) {
    return res.status(409).json({ error: 'Duplicate entry' });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
};

export const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
};
--------------------------------------------------------

import zxcvbn from 'zxcvbn';

export const validatePassword = (password) => {
  if (!password || password.length < 8) {
    return { valid: false, strength: 'weak', score: 0, message: 'Password must be at least 8 characters' };
  }

  const result = zxcvbn(password);
  
  let strength = 'weak';
  if (result.score >= 3) strength = 'strong';
  else if (result.score >= 2) strength = 'medium';

  return {
    valid: result.score >= 2,
    strength,
    score: result.score,
    message: result.feedback.suggestions[0] || 'Password is acceptable'
  };
};

export const validatePhone = (phone) => {
  const regex = /^\+?[1-9]\d{1,14}$/;
  return regex.test(phone);
};

export const validateEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}