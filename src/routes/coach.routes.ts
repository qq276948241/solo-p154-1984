import { Router } from 'express';
import * as coachController from '../controllers/coach.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/register', coachController.register);
router.post('/login', coachController.login);
router.get('/list', authMiddleware(['member', 'coach']), coachController.getCoaches);

router.get('/profile', authMiddleware(['coach']), coachController.getProfile);
router.put('/profile', authMiddleware(['coach']), coachController.updateProfile);

router.get('/schedules', authMiddleware(['coach']), coachController.getSchedules);
router.get('/schedules/today', authMiddleware(['coach']), coachController.getTodaySchedule);
router.get('/schedules/:schedule_id/checkins', authMiddleware(['coach']), coachController.getCheckInList);
router.post('/schedules/cancel', authMiddleware(['coach']), coachController.cancelSchedule);

router.post('/checkin', authMiddleware(['coach']), coachController.checkInMember);

router.post('/leave', authMiddleware(['coach']), coachController.applyLeave);
router.get('/leaves', authMiddleware(['coach']), coachController.getLeaves);

export default router;
