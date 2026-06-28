import { Router } from 'express';
import * as courseController from '../controllers/course.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/courses', authMiddleware(['member', 'coach']), courseController.getCourses);
router.get('/schedules', authMiddleware(['member', 'coach']), courseController.getSchedules);
router.post('/schedules', authMiddleware(['coach']), courseController.createSchedule);

router.post('/book', authMiddleware(['member']), courseController.bookCourse);
router.post('/cancel', authMiddleware(['member']), courseController.cancelBooking);
router.get('/my-bookings', authMiddleware(['member']), courseController.getMyBookings);

router.post('/waitlist/join', authMiddleware(['member']), courseController.joinWaitlist);
router.post('/waitlist/cancel', authMiddleware(['member']), courseController.cancelWaitlist);
router.get('/waitlist/my', authMiddleware(['member']), courseController.getMyWaitlists);

export default router;
