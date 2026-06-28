import { Request, Response } from 'express';
import { AppDataSource } from '../data-source';
import { Coach, CoachStatus } from '../entities/Coach';
import { Schedule, ScheduleStatus } from '../entities/Schedule';
import { Booking, BookingStatus } from '../entities/Booking';
import { CoachLeave, LeaveStatus } from '../entities/CoachLeave';
import { ErrorCode } from '../constants/error-code';
import { hashPassword, comparePassword } from '../utils/password';
import { isValidPhone, omit } from '../utils/validate';
import { generateToken } from '../middleware/auth';
import { Between, In } from 'typeorm';
import dayjs = require('dayjs');

const coachRepo = () => AppDataSource.getRepository(Coach);
const scheduleRepo = () => AppDataSource.getRepository(Schedule);
const bookingRepo = () => AppDataSource.getRepository(Booking);
const leaveRepo = () => AppDataSource.getRepository(CoachLeave);

export async function register(req: Request, res: Response) {
  const { phone, password, name, specialty, bio } = req.body;

  if (!isValidPhone(phone)) {
    return res.jsonFail(ErrorCode.PARAM_ERROR, '手机号格式不正确');
  }
  if (!password || password.length < 6) {
    return res.jsonFail(ErrorCode.PARAM_ERROR, '密码至少6位');
  }
  if (!name) {
    return res.jsonFail(ErrorCode.PARAM_ERROR, '请填写姓名');
  }

  const existing = await coachRepo().findOne({ where: { phone } });
  if (existing) {
    return res.jsonFail(ErrorCode.COACH_ALREADY_EXISTS);
  }

  const coach = coachRepo().create({
    phone,
    password: hashPassword(password),
    name,
    specialty: specialty || '',
    bio: bio || '',
  });
  await coachRepo().save(coach);

  const token = generateToken({
    id: coach.id,
    role: 'coach',
    phone: coach.phone,
  });

  return res.jsonSuccess(
    {
      token,
      coach: omit(coach, ['password']),
    },
    '注册成功'
  );
}

export async function login(req: Request, res: Response) {
  const { phone, password } = req.body;

  if (!isValidPhone(phone) || !password) {
    return res.jsonFail(ErrorCode.PARAM_ERROR);
  }

  const coach = await coachRepo().findOne({ where: { phone } });
  if (!coach) {
    return res.jsonFail(ErrorCode.COACH_NOT_FOUND);
  }

  if (!comparePassword(password, coach.password)) {
    return res.jsonFail(ErrorCode.COACH_PASSWORD_WRONG);
  }

  if (coach.status === CoachStatus.INACTIVE) {
    return res.jsonFail(ErrorCode.COACH_INACTIVE);
  }

  const token = generateToken({
    id: coach.id,
    role: 'coach',
    phone: coach.phone,
  });

  return res.jsonSuccess(
    {
      token,
      coach: omit(coach, ['password']),
    },
    '登录成功'
  );
}

export async function getProfile(req: Request, res: Response) {
  const coach = await coachRepo().findOne({ where: { id: req.user!.id } });
  if (!coach) {
    return res.jsonFail(ErrorCode.COACH_NOT_FOUND);
  }
  return res.jsonSuccess(omit(coach, ['password']));
}

export async function updateProfile(req: Request, res: Response) {
  const { name, avatar, specialty, bio } = req.body;
  const coach = await coachRepo().findOne({ where: { id: req.user!.id } });
  if (!coach) {
    return res.jsonFail(ErrorCode.COACH_NOT_FOUND);
  }

  if (name !== undefined) coach.name = name;
  if (avatar !== undefined) coach.avatar = avatar;
  if (specialty !== undefined) coach.specialty = specialty;
  if (bio !== undefined) coach.bio = bio;

  await coachRepo().save(coach);
  return res.jsonSuccess(omit(coach, ['password']));
}

export async function getSchedules(req: Request, res: Response) {
  const coachId = req.user!.id;
  const { start_date, end_date, status } = req.query;

  const where: any = { coach_id: coachId };

  if (start_date && end_date) {
    where.start_time = Between(
      dayjs(start_date as string).startOf('day').toDate(),
      dayjs(end_date as string).endOf('day').toDate()
    );
  } else if (start_date) {
    where.start_time = Between(
      dayjs(start_date as string).startOf('day').toDate(),
      dayjs(start_date as string).endOf('day').toDate()
    );
  }

  if (status) {
    where.status = status;
  }

  const schedules = await scheduleRepo().find({
    where,
    relations: ['course'],
    order: { start_time: 'ASC' },
  });

  const list = schedules.map((s) => ({
    id: s.id,
    course_id: s.course_id,
    course_name: s.course?.name,
    course_type: s.course?.type,
    duration_minutes: s.course?.duration_minutes,
    cost_hours: s.course?.cost_hours,
    max_capacity: s.course?.max_capacity,
    start_time: s.start_time,
    end_time: s.end_time,
    booked_count: s.booked_count,
    status: s.status,
    location: s.location,
  }));

  return res.jsonSuccess(list);
}

export async function getTodaySchedule(req: Request, res: Response) {
  const coachId = req.user!.id;
  const today = dayjs();
  const where: any = {
    coach_id: coachId,
    start_time: Between(today.startOf('day').toDate(), today.endOf('day').toDate()),
  };

  const schedules = await scheduleRepo().find({
    where,
    relations: ['course'],
    order: { start_time: 'ASC' },
  });

  const scheduleIds = schedules.map((s) => s.id);
  const bookings = scheduleIds.length
    ? await bookingRepo().find({
        where: {
          schedule_id: In(scheduleIds),
          status: In([BookingStatus.BOOKED, BookingStatus.COMPLETED]),
        },
        relations: ['member'],
      })
    : [];

  const bookingMap = new Map<number, typeof bookings>();
  bookings.forEach((b) => {
    const arr = bookingMap.get(b.schedule_id) || [];
    arr.push(b);
    bookingMap.set(b.schedule_id, arr);
  });

  const list = schedules.map((s) => {
    const bookingList = bookingMap.get(s.id) || [];
    return {
      id: s.id,
      course_id: s.course_id,
      course_name: s.course?.name,
      course_type: s.course?.type,
      start_time: s.start_time,
      end_time: s.end_time,
      location: s.location,
      booked_count: s.booked_count,
      status: s.status,
      checkin_list: bookingList.map((b) => ({
        booking_id: b.id,
        member_id: b.member_id,
        member_nickname: b.member?.nickname,
        member_phone: b.member?.phone,
        member_avatar: b.member?.avatar,
        is_checked_in: b.is_checked_in,
        checked_in_at: b.checked_in_at,
        booking_status: b.status,
      })),
    };
  });

  return res.jsonSuccess(list);
}

export async function getCheckInList(req: Request, res: Response) {
  const coachId = req.user!.id;
  const { schedule_id } = req.params;

  const schedule = await scheduleRepo().findOne({
    where: { id: Number(schedule_id), coach_id: coachId },
    relations: ['course'],
  });
  if (!schedule) {
    return res.jsonFail(ErrorCode.SCHEDULE_NOT_FOUND);
  }

  const bookings = await bookingRepo().find({
    where: {
      schedule_id: Number(schedule_id),
      status: In([BookingStatus.BOOKED, BookingStatus.COMPLETED]),
    },
    relations: ['member'],
    order: { created_at: 'ASC' },
  });

  const list = bookings.map((b) => ({
    booking_id: b.id,
    member_id: b.member_id,
    nickname: b.member?.nickname,
    phone: b.member?.phone,
    avatar: b.member?.avatar,
    is_checked_in: b.is_checked_in,
    checked_in_at: b.checked_in_at,
    status: b.status,
    deducted_hours: Number(b.deducted_hours),
    book_time: b.created_at,
  }));

  return res.jsonSuccess({
    schedule: {
      id: schedule.id,
      course_name: schedule.course?.name,
      course_type: schedule.course?.type,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      location: schedule.location,
      max_capacity: schedule.course?.max_capacity,
      booked_count: schedule.booked_count,
    },
    list,
    total: list.length,
    checked_in_count: list.filter((x) => x.is_checked_in).length,
  });
}

export async function checkInMember(req: Request, res: Response) {
  const coachId = req.user!.id;
  const { booking_id } = req.body;

  if (!booking_id) {
    return res.jsonFail(ErrorCode.PARAM_ERROR);
  }

  const booking = await bookingRepo().findOne({
    where: { id: booking_id },
    relations: ['schedule'],
  });
  if (!booking) {
    return res.jsonFail(ErrorCode.BOOKING_NOT_FOUND);
  }

  if (booking.schedule?.coach_id !== coachId) {
    return res.jsonFail(ErrorCode.FORBIDDEN);
  }

  if (booking.status === BookingStatus.CANCELLED) {
    return res.jsonFail(ErrorCode.BOOKING_ALREADY_CANCELLED);
  }

  booking.is_checked_in = 1;
  booking.checked_in_at = new Date();
  booking.status = BookingStatus.COMPLETED;
  await bookingRepo().save(booking);

  return res.jsonSuccess(
    {
      booking_id: booking.id,
      is_checked_in: booking.is_checked_in,
      checked_in_at: booking.checked_in_at,
    },
    '签到成功'
  );
}

export async function applyLeave(req: Request, res: Response) {
  const coachId = req.user!.id;
  const { leave_date, start_time, end_time, reason } = req.body;

  if (!leave_date) {
    return res.jsonFail(ErrorCode.PARAM_ERROR, '请选择请假日期');
  }

  const where: any = {
    coach_id: coachId,
    leave_date: leave_date,
    status: In([LeaveStatus.PENDING, LeaveStatus.APPROVED]),
  };

  const existing = await leaveRepo().findOne({ where });
  if (existing) {
    const hasTimeRange = existing.start_time && existing.end_time;
    const newHasTimeRange = start_time && end_time;

    if (!hasTimeRange || !newHasTimeRange) {
      return res.jsonFail(ErrorCode.LEAVE_CONFLICT);
    }

    if (
      dayjs(start_time).isBefore(existing.end_time) &&
      dayjs(end_time).isAfter(existing.start_time)
    ) {
      return res.jsonFail(ErrorCode.LEAVE_CONFLICT);
    }
  }

  const leave = leaveRepo().create({
    coach_id: coachId,
    leave_date: leave_date,
    start_time: start_time ? new Date(start_time) : null as any,
    end_time: end_time ? new Date(end_time) : null as any,
    reason: reason || '',
    status: LeaveStatus.APPROVED,
  });
  await leaveRepo().save(leave);

  return res.jsonSuccess(leave, '请假申请已提交');
}

export async function getLeaves(req: Request, res: Response) {
  const coachId = req.user!.id;
  const { page = 1, pageSize = 20, status } = req.query;

  const where: any = { coach_id: coachId };
  if (status) {
    where.status = status;
  }

  const [leaves, total] = await leaveRepo().findAndCount({
    where,
    order: { created_at: 'DESC' },
    skip: (Number(page) - 1) * Number(pageSize),
    take: Number(pageSize),
  });

  return res.jsonSuccess({
    list: leaves,
    total,
    page: Number(page),
    pageSize: Number(pageSize),
  });
}

export async function cancelSchedule(req: Request, res: Response) {
  const coachId = req.user!.id;
  const { schedule_id, reason } = req.body;

  if (!schedule_id) {
    return res.jsonFail(ErrorCode.PARAM_ERROR);
  }

  return await AppDataSource.transaction(async (manager) => {
    const schedule = await manager.findOne(Schedule, {
      where: { id: schedule_id, coach_id: coachId },
      relations: ['course'],
    });
    if (!schedule) {
      return res.jsonFail(ErrorCode.SCHEDULE_NOT_FOUND);
    }
    if (schedule.status === ScheduleStatus.CANCELLED) {
      return res.jsonFail(ErrorCode.SCHEDULE_CANCELLED);
    }
    if (schedule.status === ScheduleStatus.COMPLETED) {
      return res.jsonFail(ErrorCode.SCHEDULE_COMPLETED);
    }

    const bookings = await manager.find(Booking, {
      where: {
        schedule_id: schedule_id,
        status: BookingStatus.BOOKED,
      },
      relations: ['member'],
    });

    for (const booking of bookings) {
      const refundHours = Number(booking.deducted_hours);
      const member = booking.member;

      member.remaining_hours = Number(member.remaining_hours) + refundHours;
      member.used_hours = Math.max(
        0,
        Number(member.used_hours) - refundHours
      );
      await manager.save(member);

      booking.status = BookingStatus.CANCELLED;
      booking.cancelled_at = new Date();
      booking.cancel_reason = `教练取消：${reason || '临时调整'}`;
      booking.refunded_hours = refundHours;
      await manager.save(booking);

      const { CourseRecord, RecordType } = await import('../entities/CourseRecord');
      const record = manager.create(CourseRecord, {
        member_id: member.id,
        booking_id: booking.id,
        type: RecordType.REFUND,
        hours_change: refundHours,
        remaining_after: Number(member.remaining_hours),
        remark: `教练取消课程，全额退款`,
      });
      await manager.save(record);
    }

    schedule.status = ScheduleStatus.CANCELLED;
    await manager.save(schedule);

    return res.jsonSuccess(
      {
        schedule_id: schedule.id,
        refunded_count: bookings.length,
      },
      '课程已取消，已全额退还学员课时'
    );
  });
}

export async function getCoaches(req: Request, res: Response) {
  const coaches = await coachRepo().find({
    where: { status: CoachStatus.ACTIVE },
    order: { id: 'ASC' },
  });

  const list = coaches.map((c) => omit(c, ['password']));
  return res.jsonSuccess(list);
}
