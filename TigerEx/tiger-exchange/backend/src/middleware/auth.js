import jwt from 'jsonwebtoken';
import Session from '../models/Session.js';
import User from '../models/User.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/constants.js';

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1] || req.cookies?.tigerex_jwt;
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const session = await Session.findOne({ token, userId: decoded.id });
    
    if (!session) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    if (new Date(session.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'Session expired' });
    }

    const user = await User.findById(decoded.id).select('-password -passwordHistory');
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'User not active' });
    }

    req.user = {
      id: user._id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      kyc: user.kyc,
      profile: user.profile
    };

    session.lastActiveAt = new Date();
    await session.save();
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1] || req.cookies?.tigerex_jwt;
    
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password -passwordHistory');
      if (user && user.status === 'active') {
        req.user = {
          id: user._id,
          email: user.email,
          phone: user.phone,
          role: user.role
        };
      }
    }
    next();
  } catch {
    next();
  }
};

export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

export const requireKYC = async (req, res, next) => {
  if (!req.user?.kyc?.approved) {
    return res.status(403).json({ error: 'KYC verification required' });
  }
  next();
};

export const requireWithdrawal = async (req, res, next) => {
  if (!req.user?.withdrawalsEnabled) {
    return res.status(403).json({ error: 'Withdrawals disabled for 48 hours after changes' });
  }
  next();
};