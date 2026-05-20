import express from 'express';
import * as adminController from '../controllers/adminController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);
router.use(requireRole('admin', 'super_admin', 'moderator'));

router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUserById);
router.put('/users/:id', adminController.updateUser);
router.post('/users/:id/kyc', adminController.reviewKYC);
router.post('/users/:id/force-logout', adminController.forceLogout);
router.post('/users/:id/unlock', adminController.unlockUser);
router.get('/stats', adminController.getStats);
router.get('/audit-logs', adminController.getAuditLogs);

export default router;