import express from 'express';
import multer from 'multer';
import * as userController from '../controllers/userController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.use(authenticate);

router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.put('/preferences', userController.updatePreferences);
router.post('/kyc', upload.single('document'), userController.submitKYC);
router.post('/upload-document', upload.single('file'), userController.uploadDocument);
router.post('/liveness', userController.verifyLiveness);
router.get('/sessions', userController.getSessions);
router.delete('/sessions/:sessionId', userController.revokeSession);
router.get('/notifications', userController.getNotifications);
router.put('/notifications/:id/read', userController.markNotificationRead);
router.get('/audit-logs', userController.getAuditLogs);

export default router;