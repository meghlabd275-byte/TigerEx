import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  token: {
    type: String,
    required: true,
    unique: true,
    sparse: true
  },
  refreshToken: String,
  deviceInfo: String,
  deviceId: String,
  ip: String,
  userAgent: String,
  location: String,
  country: String,
  city: String,
  lat: Number,
  lon: Number,
  expiresAt: Date,
  lastActiveAt: Date,
  createdAt: { type: Date, default: Date.now },
  user: {
    email: String,
    phone: String,
    role: String,
    twoFactorEnabled: Boolean
  }
}, {
  timestamps: true
});

sessionSchema.index({ userId: 1, createdAt: -1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

sessionSchema.statics.cleanup = async function() {
  return this.deleteMany({ expiresAt: { $lt: new Date() } });
};

const Session = mongoose.model('Session', sessionSchema);
export default Session;