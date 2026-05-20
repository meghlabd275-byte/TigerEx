import express from 'express';
import { body, validationResult } from 'express-validator';
import * as authController from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/register', [
  body('identifier').notEmpty().withMessage('Email or phone required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be 8+ characters')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  authController.register(req, res).catch(next);
});

router.post('/login', [
  body('identifier').notEmpty(),
  body('password').notEmpty()
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  authController.login(req, res).catch(next);
});

router.post('/verify-2fa', [
  body('userId').notEmpty(),
  body('code').isLength({ min: 6, max: 6 })
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  authController.verify2FA(req, res).catch(next);
});

router.post('/send-verification', 
  body('identifier').notEmpty(),
  async (req, res, next) => {
    authController.sendVerificationCode(req, res).catch(next);
  }
);

router.post('/verify-code', [
  body('identifier').notEmpty(),
  body('code').isLength({ min: 6, max: 6 })
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  authController.verifyCode(req, res).catch(next);
});

router.post('/reset-password', [
  body('identifier').notEmpty(),
  body('code').isLength({ min: 6, max: 6 }),
  body('newPassword').isLength({ min: 8 })
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  authController.resetPassword(req, res).catch(next);
});

router.post('/2fa/setup', authenticate, async (req, res, next) => {
  authController.setup2FA(req, res).catch(next);
});

router.post('/2fa/confirm', authenticate, async (req, res, next) => {
  authController.confirm2FA(req, res).catch(next);
});

router.post('/2fa/reset', async (req, res, next) => {
  authController.reset2FA(req, res).catch(next);
});

router.post('/logout', authenticate, async (req, res, next) => {
  authController.logout(req, res).catch(next);
});

router.post('/refresh', async (req, res, next) => {
  authController.refreshToken(req, res).catch(next);
});

router.post('/social', [
  body('provider').isIn(['google', 'apple', 'telegram']),
  body('accessToken').notEmpty()
], async (req, res, next) => {
  authController.socialLogin(req, res).catch(next);
});

router.post('/metamask/connect', async (req, res, next) => {
  authController.metamaskConnect(req, res).catch(next);
});

router.post('/change-field', authenticate, async (req, res, next) => {
  authController.changeField(req, res).catch(next);
});

router.post('/confirm-change', authenticate, async (req, res, next) => {
  authController.confirmChange(req, res).catch(next);
});

router.post('/delete-account', authenticate, async (req, res, next) => {
  authController.deleteAccount(req, res).catch(next);
});

router.get('/countries', authController.getCountries);

router.post('/check-registration', async (req, res, next) => {
  authController.checkRegistration(req, res).catch(next);
});

export default router;