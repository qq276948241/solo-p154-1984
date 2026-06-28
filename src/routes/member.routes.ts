import { Router } from 'express';
import * as memberController from '../controllers/member.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/register', memberController.register);
router.post('/login', memberController.login);
router.get('/profile', authMiddleware(['member']), memberController.getProfile);
router.put('/profile', authMiddleware(['member']), memberController.updateProfile);
router.get('/hours', authMiddleware(['member']), memberController.getRemainingHours);
router.get('/records', authMiddleware(['member']), memberController.getCourseRecords);

export default router;
