import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import cryptoRandomString from 'crypto-random-string';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    lowercase: true,
    trim: true,
    sparse: true,
    index: true
  },
  phone: {
    type: String,
    trim: true,
    sparse: true,
    index: true
  },
  phoneCountryCode: String,
  password: String,
  passwordHistory: [{
    password: String,
    changedAt: Date
  }],
  referralCode: {
    type: String,
    unique: true,
    sparse: true
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  profile: {
    title: String,
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    dateOfBirth: Date,
    gender: String,
    address: {
      street: String,
      city: String,
      state: String,
      postalCode: String,
      country: String
    }
  },
  twoFactorAuth: {
    enabled: { type: Boolean, default: false },
    secret: String,
    backupCodes: [String],
    method: {
      type: String,
      enum: ['totp', 'sms'],
      default: 'totp'
    },
    phoneLast4: String,
    lastResetAt: Date
  },
  kyc: {
    status: {
      type: String,
      enum: ['none', 'pending', 'under_review', 'approved', 'rejected'],
      default: 'none'
    },
    submittedAt: Date,
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: String,
    documents: [{
      type: { type: String, enum: ['passport', 'drivers_license', 'national_id'] },
      frontImage: String,
      backImage: String,
      selfieImage: String,
      verified: Boolean
    }],
    livenessData: {
      verifiedAt: Date,
      confidenceScore: Number,
      facialMetrics: mongoose.Schema.Types.Mixed
    },
    addressProof: {
      type: String,
      document: String,
      verified: Boolean
    }
  },
  oauth: {
    google: {
      id: String,
      email: String
    },
    apple: {
      id: String,
      email: String
    },
    telegram: {
      id: String,
      username: String
    },
    metamask: {
      address: String,
      nonce: String
    }
  },
  passkey: {
    credentialId: String,
    publicKey: String,
    counter: Number
  },
  role: {
    type: String,
    enum: ['user', 'trader', 'vip', 'partner', 'moderator', 'admin', 'super_admin'],
    default: 'user'
  },
  status: {
    type: String,
    enum: ['active', 'locked', 'suspended', 'closed', 'deleted'],
    default: 'active'
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockedUntil: Date,
  lastLoginAt: Date,
  lastLoginIP: String,
  lastLoginUA: String,
  lastPasswordChangeAt: Date,
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationCode: String,
  emailVerificationExpires: Date,
  phoneVerificationCode: String,
  phoneVerificationExpires: Date,
  passwordResetCode: String,
  passwordResetExpires: Date,
  passwordResetAttempts: {
    type: Number,
    default: 0
  },
  withdrawalsEnabled: {
    type: Boolean,
    default: false
  },
  withdrawalsEnabledAt: Date,
  withdrawalLockUntil: Date,
  twoFactorResetPending: {
    type: Boolean,
    default: false
  },
  twoFactorResetRequestedAt: Date,
  twoFactorResetVerifiedData: {
    emailCode: String,
    phoneCode: String,
    livenessVerified: Boolean,
    verifiedAt: Date
  },
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system'
    },
    language: {
      type: String,
      default: 'en'
    },
    currency: {
      type: String,
      default: 'USD'
    },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true }
    }
  },
  deviceTokens: [String],
  sessions: [{
    token: String,
    createdAt: Date,
    expiresAt: Date,
    deviceInfo: String,
    ip: String,
    userAgent: String,
    location: String,
    lastActiveAt: Date
  }],
  rememberMeTokens: [{
    token: String,
    expiresAt: Date,
    deviceInfo: String,
    createdAt: Date
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date,
  deletedAt: Date
}, {
  timestamps: true,
  toJSON: {
    transform: (doc, ret) => {
      delete ret.password;
      delete ret.passwordHistory;
      delete ret.twoFactorAuth?.secret;
      delete ret.twoFactorAuth?.backupCodes;
      delete ret.oauth?.google?.id;
      delete ret.oauth?.apple?.id;
      return ret;
    }
  }
});

userSchema.index({ email: 1 }, { sparse: true });
userSchema.index({ phone: 1 }, { sparse: true });
userSchema.index({ referralCode: 1 }, { sparse: true });
userSchema.index({ 'oauth.google.email': 1 }, { sparse: true });

userSchema.pre('save', async function(next) {
  if (!this.referralCode) {
    this.referralCode = cryptoRandomString({ length: 10, type: 'alphanumeric' }).toUpperCase();
  }
  if (this.isModified('password') && this.password) {
    const hashed = await bcrypt.hash(this.password, 12);
    this.password = hashed;
    this.lastPasswordChangeAt = new Date();
    if (!this.passwordHistory) this.passwordHistory = [];
    this.passwordHistory.unshift({ password: hashed, changedAt: new Date() });
    if (this.passwordHistory.length > 5) this.passwordHistory = this.passwordHistory.slice(0, 5);
  }
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generateOTP = function() {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

userSchema.methods.getInitials = function() {
  if (this.profile?.firstName && this.profile?.lastName) {
    return `${this.profile.firstName[0]}${this.profile.lastName[0]}`.toUpperCase();
  }
  return (this.email?.[0] || this.phone?.slice(-2) || 'U').toUpperCase();
};

userSchema.statics.findByEmailOrPhone = function(identifier) {
  const query = identifier.includes('@') 
    ? { email: identifier.toLowerCase().trim() }
    : { phone: identifier.trim() };
  return this.findOne(query);
};

userSchema.statics.normalizeIdentifier = function(identifier) {
  if (identifier.includes('@')) {
    return { type: 'email', value: identifier.toLowerCase().trim() };
  }
  return { type: 'phone', value: identifier.trim() };
};

const User = mongoose.model('User', userSchema);
export default User;