import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
  identifier: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['email', 'phone', '2fa', 'password_reset', 'kyc'],
    required: true
  },
  code: {
    type: String,
    required: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  verified: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  ip: String,
  createdAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

otpSchema.index({ identifier: 1, type: 1 });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OTP = mongoose.model('OTP', otpSchema);
export default OTP;

-------------------------------------------------

import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  action: {
    type: String,
    required: true,
    index: true
  },
  description: String,
  ip: String,
  userAgent: String,
  location: String,
  metadata: mongoose.Schema.Types.Mixed,
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['success', 'failed', 'blocked'],
    default: 'success'
  },
  createdAt: { type: Date, default: Date.now, index: true }
}, {
  timestamps: true,
  capped: { size: 1073741824 }
});

auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;

-------------------------------------------------

import mongoose from 'mongoose';

const accountChangeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['email', 'phone', 'password', '2fa', 'withdrawal'],
    required: true
  },
  oldValue: String,
  newValue: String,
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled', 'failed'],
    default: 'pending'
  },
  verificationData: {
    emailCode: String,
    phoneCode: String,
    livenessVerified: Boolean,
    verifiedAt: Date
  },
  completedAt: Date,
  requestedAt: { type: Date, default: Date.now },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 48 * 60 * 60 * 1000)
  },
  adminReviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  adminNotes: String
}, {
  timestamps: true
});

accountChangeSchema.index({ userId: 1, type: 1, status: 1 });
accountChangeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AccountChange = mongoose.model('AccountChange', accountChangeSchema);
export default AccountChange;

-------------------------------------------------

import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['email_verification', 'phone_verification', 'password_reset', '2fa', 'kyc', 'withdrawal', 'security', 'account'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  data: mongoose.Schema.Types.Mixed,
  channel: {
    type: String,
    enum: ['email', 'sms', 'push', 'in_app'],
    default: 'in_app'
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'failed'],
    default: 'pending'
  },
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  createdAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;

-------------------------------------------------

import mongoose from 'mongoose';

const rateLimitSchema = new mongoose.Schema({
  identifier: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['login', 'register', 'otp', 'password_reset'],
    required: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  blockedUntil: Date,
  firstAttemptAt: Date,
  lastAttemptAt: Date,
  createdAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

rateLimitSchema.index({ identifier: 1, type: 1 });
rateLimitSchema.index({ blockedUntil: 1 }, { expireAfterSeconds: 0 });

const RateLimit = mongoose.model('RateLimit', rateLimitSchema);
export default RateLimit;