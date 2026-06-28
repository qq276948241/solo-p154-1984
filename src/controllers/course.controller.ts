import { Request, Response } from 'express';
import { AppDataSource } from '../data-source';
import { Course } from '../entities/Course';
import { Schedule } from '../entities/Schedule';
import { ErrorCode } from '../constants/error-code';
import { Between, LessThan, MoreThan } from 'typeorm';
import dayjs = require('dayjs');

import { ScheduleService } from '../services/ScheduleService';
import { BookingService } from '../services/BookingService';
import { WaitlistService } from '../services/WaitlistService';

const courseRepo = () => AppDataSource.getRepository(Course);
const scheduleRepo = () => AppDataSource.getRepository(Schedule);

export async function getCourses(req: Request, res: Response) {
  const { type, is_active = 1 } = req.query;
  const where: any = { is_active: Number(is_active) };
  if (type) where.type = type;
  const courses = await courseRepo().find({ where, order: { id: 'DESC' } });
  return res.jsonSuccess(courses);
}

export async function getSchedules(req: Request, res: Response) {
  const {
    coach_id,
    course_id,
    course_type,
    start_date,
    end_date,
    page = 1,
    pageSize = 50,
  } = req.query;

  const where: any = {};
  if (coach_id) where.coach_id = Number(coach_id);
  if (course_id) where.course_id = Number(course_id);

  if (start_date && end_date) {
    where.start_time = Between(
      dayjs(start_date as string).startOf('day').toDate(),
      dayjs(end_date as string).endOf('day').toDate()
    );
  } else if (start_date) {
    where.start_time = MoreThan(
      dayjs(start_date as string).startOf('day').toDate()
    );
  } else if (end_date) {
    where.start_time = LessThan(
      dayjs(end_date as string).endOf('day').toDate()
    );
  }

  const query = scheduleRepo()
    .createQueryBuilder('schedule')
    .leftJoinAndSelect('schedule.course', 'course')
    .leftJoinAndSelect('schedule.coach', 'coach')
    .where(where)
    .orderBy('schedule.start_time', 'ASC')
    .skip((Number(page) - 1) * Number(pageSize))
    .take(Number(pageSize));

  if (course_type) {
    query.andWhere('course.type = :type', { type: course_type });
  }

  const [schedules, total] = await query.getManyAndCount();

  const list = schedules.map((s) => ({
    id: s.id,
    coach_id: s.coach_id,
    coach_name: s.coach?.name,
    coach_avatar: s.coach?.avatar,
    course_id: s.course_id,
    course_name: s.course?.name,
    course_type: s.course?.type,
    course_duration: s.course?.duration_minutes,
    cost_hours: s.course?.cost_hours,
    max_capacity: s.course?.max_capacity,
    start_time: s.start_time,
    end_time: s.end_time,
    booked_count: s.booked_count,
    status: s.status,
    location: s.location,
  }));

  return res.jsonSuccess({
    list,
    total,
    page: Number(page),
    pageSize: Number(pageSize),
  });
}

export async function createSchedule(req: Request, res: Response) {
  const schedule = await ScheduleService.createSchedule(req.body);
  return res.jsonSuccess(schedule, '排课创建成功');
}

export async function bookCourse(req: Request, res: Response) {
  const memberId = req.user!.id;
  const { schedule_id } = req.body;
  const result = await BookingService.bookCourse(memberId, schedule_id);
  return res.jsonSuccess(result, '约课成功');
}

export async function cancelBooking(req: Request, res: Response) {
  const memberId = req.user!.id;
  const { booking_id, reason } = req.body;
  const result = await BookingService.cancelBooking(
    memberId,
    booking_id,
    reason
  );
  return res.jsonSuccess(result, '取消成功');
}

export async function getMyBookings(req: Request, res: Response) {
  const memberId = req.user!.id;
  const { status, page, pageSize } = req.query;
  const result = await BookingService.getMyBookings(
    memberId,
    status as string | undefined,
    page ? Number(page) : undefined,
    pageSize ? Number(pageSize) : undefined
  );
  return res.jsonSuccess(result);
}

export async function joinWaitlist(req: Request, res: Response) {
  const memberId = req.user!.id;
  const { schedule_id } = req.body;
  const result = await WaitlistService.joinWaitlist(memberId, schedule_id);
  return res.jsonSuccess(
    result,
    '已加入候补队列，有空位将自动为您预约'
  );
}

export async function cancelWaitlist(req: Request, res: Response) {
  const memberId = req.user!.id;
  const { waitlist_id, reason } = req.body;
  const result = await WaitlistService.cancelWaitlist(
    memberId,
    waitlist_id,
    reason
  );
  return res.jsonSuccess(result, '已退出候补队列');
}

export async function getMyWaitlists(req: Request, res: Response) {
  const memberId = req.user!.id;
  const { status, page, pageSize } = req.query;
  const result = await WaitlistService.getMyWaitlists(
    memberId,
    status as string | undefined,
    page ? Number(page) : undefined,
    pageSize ? Number(pageSize) : undefined
  );
  return res.jsonSuccess(result);
}
