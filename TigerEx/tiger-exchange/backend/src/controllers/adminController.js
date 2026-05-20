import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';

export const getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, kyc, search, role } = req.query;
    const query = {};
    
    if (status) query.status = status;
    if (kyc) query['kyc.status'] = kyc;
    if (role) query.role = role;
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { 'profile.firstName': { $regex: search, $options: 'i' } },
        { 'profile.lastName': { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password -passwordHistory')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      users,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get users' });
  }
};

export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -passwordHistory');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user' });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { role, status, kycStatus, notes } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (role && ['user', 'trader', 'vip', 'partner', 'moderator', 'admin', 'super_admin'].includes(role)) {
      user.role = role;
    }
    if (status && ['active', 'locked', 'suspended', 'closed'].includes(status)) {
      user.status = status;
    }
    if (kycStatus && ['none', 'pending', 'under_review', 'approved', 'rejected'].includes(kycStatus)) {
      user.kyc.status = kycStatus;
      if (kycStatus === 'approved' || kycStatus === 'rejected') {
        user.kyc.reviewedAt = new Date();
        user.kyc.reviewedBy = req.user.id;
        
        if (kycStatus === 'approved') {
          user.withdrawalsEnabled = true;
          user.withdrawalsEnabledAt = new Date();
        }
      }
    }
    await user.save();

    await AuditLog.create({
      userId: user._id,
      action: 'admin_update',
      adminId: req.user.id,
      metadata: { role, status, kycStatus, notes },
      status: 'success'
    });

    res.json({ message: 'User updated', user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
};

export const reviewKYC = async (req, res) => {
  try {
    const { status, reason } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.kyc.status = status;
    user.kyc.reviewedAt = new Date();
    user.kyc.reviewedBy = req.user.id;
    if (status === 'rejected') {
      user.kyc.rejectionReason = reason;
    }
    if (status === 'approved') {
      user.withdrawalsEnabled = true;
      user.withdrawalsEnabledAt = new Date();
    }
    await user.save();

    await AuditLog.create({
      userId: user._id,
      action: status === 'approved' ? 'kyc_approve' : 'kyc_reject',
      adminId: req.user.id,
      metadata: { reason },
      status: 'success'
    });

    res.json({ message: `KYC ${status}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to review KYC' });
  }
};

export const getStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: 'active' });
    const verifiedKYC = await User.countDocuments({ 'kyc.status': 'approved' });
    const pendingKYC = await User.countDocuments({ 'kyc.status': 'pending' });
    
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const newUsers = await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });

    res.json({
      totalUsers,
      activeUsers,
      verifiedKYC,
      pendingKYC,
      newUsers
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
};

export const getAuditLogs = async (req, res) => {
  try {
    const { userId, action, page = 1, limit = 50 } = req.query;
    const query = {};
    if (userId) query.userId = userId;
    if (action) query.action = action;

    const logs = await AuditLog.find(query)
      .populate('userId', 'email profile.firstName profile.lastName')
      .populate('adminId', 'email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get audit logs' });
  }
};

export const forceLogout = async (req, res) => {
  try {
    const Session = (await import('../models/Session.js')).default;
    const result = await Session.deleteMany({ userId: req.params.id });
    await AuditLog.create({
      userId: req.params.id,
      action: 'admin_force_logout',
      adminId: req.user.id,
      status: 'success'
    });
    res.json({ message: 'Force logged out', sessionsRevoked: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to force logout' });
  }
};

export const unlockUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    user.loginAttempts = 0;
    user.lockedUntil = undefined;
    await user.save();

    await AuditLog.create({
      userId: user._id,
      action: 'admin_unlock',
      adminId: req.user.id,
      status: 'success'
    });

    res.json({ message: 'User unlocked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unlock user' });
  }
};