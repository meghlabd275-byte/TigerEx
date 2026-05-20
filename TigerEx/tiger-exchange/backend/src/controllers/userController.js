import User from '../models/User.js';

export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -passwordHistory');
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get profile' });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, title, dateOfBirth, gender, address } = req.body;
    const user = await User.findById(req.user.id);
    
    if (firstName) user.profile.firstName = firstName;
    if (lastName) user.profile.lastName = lastName;
    if (title) user.profile.title = title;
    if (dateOfBirth) user.profile.dateOfBirth = dateOfBirth;
    if (gender) user.profile.gender = gender;
    if (address) user.profile.address = address;
    
    await user.save();
    res.json({ message: 'Profile updated', user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

export const updatePreferences = async (req, res) => {
  try {
    const { theme, language, currency, notifications } = req.body;
    const user = await User.findById(req.user.id);
    
    if (theme) user.preferences.theme = theme;
    if (language) user.preferences.language = language;
    if (currency) user.preferences.currency = currency;
    if (notifications) user.preferences.notifications = notifications;
    
    await user.save();
    res.json({ message: 'Preferences updated', preferences: user.preferences });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update preferences' });
  }
};

export const submitKYC = async (req, res) => {
  try {
    const { documentType, firstName, lastName, address, documentImages, selfieImage } = req.body;
    
    const user = await User.findById(req.user.id);
    
    if (!user.emailVerified || !user.phoneVerified) {
      return res.status(400).json({ error: 'Verify email and phone first' });
    }

    user.profile.firstName = firstName || user.profile.firstName;
    user.profile.lastName = lastName || user.profile.lastName;
    user.profile.address = address || user.profile.address;
    
    user.kyc.documents.push({
      type: documentType,
      selfieImage,
      verified: false
    });
    user.kyc.status = 'pending';
    user.kyc.submittedAt = new Date();
    
    await user.save();
    res.json({ message: 'KYC submitted for review' });
  } catch (error) {
    console.error('KYC submit error:', error);
    res.status(500).json({ error: 'Failed to submit KYC' });
  }
};

export const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const user = await User.findById(req.user.id);
    user.kyc.documents.push({
      type: req.body.documentType,
      frontImage: `/uploads/${req.file.filename}`,
      verified: false
    });
    await user.save();
    
    res.json({ message: 'Document uploaded', path: req.file.path });
  } catch (error) {
    res.status(500).json({ error: 'Upload failed' });
  }
};

export const verifyLiveness = async (req, res) => {
  try {
    const { image, actions } = req.body;
    // Simulate liveness check (would use face-api.js in production)
    const confidence = Math.random() * 0.5 + 0.5;
    
    if (confidence < 0.7) {
      return res.status(400).json({ error: 'Liveness check failed' });
    }
    
    res.json({ verified: true, confidence });
  } catch (error) {
    res.status(500).json({ error: 'Liveness check failed' });
  }
};

export const getSessions = async (req, res) => {
  try {
    const Session = (await import('../models/Session.js')).default;
    const sessions = await Session.find({ userId: req.user.id })
      .select('-token -refreshToken')
      .sort({ createdAt: -1 })
      .limit(20);
    
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get sessions' });
  }
};

export const revokeSession = async (req, res) => {
  try {
    const Session = (await import('../models/Session.js')).default;
    await Session.findByIdAndDelete(req.params.sessionId);
    res.json({ message: 'Session revoked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to revoke session' });
  }
};

export const getNotifications = async (req, res) => {
  try {
    const Notification = (await import('../models/index.js')).default;
    const notifications = await Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json({ notifications });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get notifications' });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const Notification = (await import('../models/index.js')).default;
    await Notification.findByIdAndUpdate(req.params.id, { readAt: new Date() });
    res.json({ message: 'Marked as read' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};

export const getAuditLogs = async (req, res) => {
  try {
    const AuditLog = (await import('../models/index.js')).default;
    const logs = await AuditLog.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get audit logs' });
  }
};