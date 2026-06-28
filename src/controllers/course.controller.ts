import { Request, Response } from 'express';
import { AppDataSource } from '../data-source';
import { Course, CourseType } from '../entities/Course';
import { Schedule, ScheduleStatus } from '../entities/Schedule';
import { Booking, BookingStatus } from '../entities/Booking';
import { Member } from '../entities/Member';
import { Coach, CoachStatus } from '../entities/Coach';
import { CourseRecord, RecordType } from '../entities/CourseRecord';
import { CoachLeave, LeaveStatus } from '../entities/CoachLeave';
import { Waitlist, WaitlistStatus } from '../entities/Waitlist';
import { ErrorCode } from '../constants/error-code';
import { Between, LessThan, MoreThan, And, In } from 'typeorm';
import dayjs = require('dayjs');

const courseRepo = () => AppDataSource.getRepository(Course);
const scheduleRepo = () => AppDataSource.getRepository(Schedule);
const bookingRepo = () => AppDataSource.getRepository(Booking);
const memberRepo = () => AppDataSource.getRepository(Member);
const coachRepo = () => AppDataSource.getRepository(Coach);
const recordRepo = () => AppDataSource.getRepository(CourseRecord);
const leaveRepo = () => AppDataSource.getRepository(CoachLeave);
const waitlistRepo = () => AppDataSource.getRepository(Waitlist);

export async function getCourses(req: Request, res: Response) {
  const { type, is_active = 1 } = req.query;
  const where: any = { is_active: Number(is_active) };
  if (type) {
    where.type = type;
  }
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

  if (coach_id) {
    where.coach_id = Number(coach_id);
  }
  if (course_id) {
    where.course_id = Number(course_id);
  }

  if (start_date && end_date) {
    where.start_time = Between(
      dayjs(start_date as string).startOf('day').toDate(),
      dayjs(end_date as string).endOf('day').toDate()
    );
  } else if (start_date) {
    where.start_time = MoreThan(dayjs(start_date as string).startOf('day').toDate());
  } else if (end_date) {
    where.start_time = LessThan(dayjs(end_date as string).endOf('day').toDate());
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

async function checkCoachTimeConflict(
  coachId: number,
  startTime: Date,
  endTime: Date,
  excludeScheduleId?: number
): Promise<boolean> {
  const qb = scheduleRepo()
    .createQueryBuilder('s')
    .where('s.coach_id = :coachId', { coachId })
    .andWhere('s.status NOT IN (:...statuses)', {
      statuses: [ScheduleStatus.CANCELLED],
    })
    .andWhere(
      `s.start_time < :endTime AND s.end_time > :startTime`,
      { endTime, startTime }
    );

  if (excludeScheduleId) {
    qb.andWhere('s.id != :id', { id: excludeScheduleId });
  }

  const count = await qb.getCount();
  return count > 0;
}

async function checkCoachOnLeave(
  coachId: number,
  startTime: Date,
  endTime: Date
): Promise<boolean> {
  const leaveDate = dayjs(startTime).format('YYYY-MM-DD');
  const leave = await leaveRepo().findOne({
    where: {
      coach_id: coachId,
      leave_date: leaveDate as any,
      status: LeaveStatus.APPROVED,
    },
  });

  if (!leave) return false;

  if (leave.start_time && leave.end_time) {
    return (
      dayjs(startTime).isBefore(leave.end_time) &&
      dayjs(endTime).isAfter(leave.start_time)
    );
  }
  return true;
}

export async function createSchedule(req: Request, res: Response) {
  const { coach_id, course_id, start_time, end_time, location } = req.body;

  if (!coach_id || !course_id || !start_time || !end_time) {
    return res.jsonFail(ErrorCode.PARAM_ERROR);
  }

  const coach = await coachRepo().findOne({ where: { id: coach_id } });
  if (!coach) {
    return res.jsonFail(ErrorCode.COACH_NOT_FOUND);
  }
  if (coach.status === CoachStatus.INACTIVE) {
    return res.jsonFail(ErrorCode.COACH_INACTIVE);
  }

  const course = await courseRepo().findOne({ where: { id: course_id } });
  if (!course) {
    return res.jsonFail(ErrorCode.COURSE_NOT_FOUND);
  }
  if (!course.is_active) {
    return res.jsonFail(ErrorCode.COURSE_INACTIVE);
  }

  const startTime = new Date(start_time);
  const endTime = new Date(end_time);

  if (startTime >= endTime) {
    return res.jsonFail(ErrorCode.PARAM_ERROR, '结束时间必须晚于开始时间');
  }

  const hasConflict = await checkCoachTimeConflict(coach_id, startTime, endTime);
  if (hasConflict) {
    return res.jsonFail(ErrorCode.SCHEDULE_TIME_CONFLICT);
  }

  const onLeave = await checkCoachOnLeave(coach_id, startTime, endTime);
  if (onLeave) {
    return res.jsonFail(ErrorCode.COACH_ON_LEAVE);
  }

  const schedule = scheduleRepo().create({
    coach_id,
    course_id,
    start_time: startTime,
    end_time: endTime,
    location: location || '',
    status: ScheduleStatus.AVAILABLE,
    booked_count: 0,
  });

  await scheduleRepo().save(schedule);
  return res.jsonSuccess(schedule, '排课创建成功');
}

export async function bookCourse(req: Request, res: Response) {
  const memberId = req.user!.id;
  const { schedule_id } = req.body;

  if (!schedule_id) {
    return res.jsonFail(ErrorCode.PARAM_ERROR);
  }

  return await AppDataSource.transaction(async (manager) => {
    const schedule = await manager.findOne(Schedule, {
      where: { id: schedule_id },
      relations: ['course', 'coach'],
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
    if (dayjs(schedule.start_time).isBefore(dayjs())) {
      return res.jsonFail(ErrorCode.SCHEDULE_PAST);
    }

    const existingBooking = await manager.findOne(Booking, {
      where: {
        member_id: memberId,
        schedule_id: schedule_id,
        status: In([BookingStatus.BOOKED, BookingStatus.COMPLETED]),
      },
    });
    if (existingBooking) {
      return res.jsonFail(ErrorCode.BOOKING_ALREADY_EXISTS);
    }

    if (schedule.coach) {
      const onLeave = await checkCoachOnLeave(
        schedule.coach_id,
        schedule.start_time,
        schedule.end_time
      );
      if (onLeave) {
        return res.jsonFail(ErrorCode.COACH_ON_LEAVE);
      }
    }

    const costHours = Number(schedule.course?.cost_hours || 1);

    const member = await manager.findOne(Member, {
      where: { id: memberId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!member) {
      return res.jsonFail(ErrorCode.MEMBER_NOT_FOUND);
    }

    if (Number(member.remaining_hours) < costHours) {
      return res.jsonFail(ErrorCode.MEMBER_HOURS_INSUFFICIENT);
    }

    if (schedule.course?.type === CourseType.PRIVATE) {
      const hasConflict = await checkCoachTimeConflict(
        schedule.coach_id,
        schedule.start_time,
        schedule.end_time,
        schedule.id
      );
      if (hasConflict) {
        return res.jsonFail(ErrorCode.SCHEDULE_TIME_CONFLICT);
      }
    }

    if (schedule.course?.type === CourseType.GROUP) {
      const maxCap = schedule.course?.max_capacity || 0;
      if (maxCap > 0 && schedule.booked_count >= maxCap) {
        const queuedCount = await manager.count(Waitlist, {
          where: {
            schedule_id: schedule.id,
            status: WaitlistStatus.QUEUED,
          },
        });
        const alreadyQueued = await manager.findOne(Waitlist, {
          where: {
            schedule_id: schedule.id,
            member_id: memberId,
            status: WaitlistStatus.QUEUED,
          },
        });
        return res.jsonFail(ErrorCode.WAITLIST_FULL_PROMPT, undefined, {
          schedule_id: schedule.id,
          course_name: schedule.course?.name,
          start_time: schedule.start_time,
          end_time: schedule.end_time,
          coach_name: schedule.coach?.name,
          cost_hours: costHours,
          current_waitlist_count: queuedCount,
          already_in_waitlist: !!alreadyQueued,
        });
      }
    }

    member.remaining_hours = Number(member.remaining_hours) - costHours;
    member.used_hours = Number(member.used_hours) + costHours;
    await manager.save(member);

    const booking = manager.create(Booking, {
      member_id: memberId,
      schedule_id: schedule_id,
      status: BookingStatus.BOOKED,
      deducted_hours: costHours,
      refunded_hours: 0,
    });
    await manager.save(booking);

    schedule.booked_count = schedule.booked_count + 1;
    if (
      schedule.course?.type === CourseType.GROUP &&
      schedule.course.max_capacity &&
      schedule.booked_count >= schedule.course.max_capacity
    ) {
      schedule.status = ScheduleStatus.FULL;
    }
    await manager.save(schedule);

    const record = manager.create(CourseRecord, {
      member_id: memberId,
      booking_id: booking.id,
      type: RecordType.DEDUCT,
      hours_change: -costHours,
      remaining_after: Number(member.remaining_hours),
      remark: `预约${schedule.course?.name || '课程'}`,
    });
    await manager.save(record);

    return res.jsonSuccess(
      {
        booking_id: booking.id,
        deducted_hours: costHours,
        remaining_hours: Number(member.remaining_hours),
      },
      '约课成功'
    );
  });
}

export async function cancelBooking(req: Request, res: Response) {
  const memberId = req.user!.id;
  const { booking_id, reason } = req.body;

  if (!booking_id) {
    return res.jsonFail(ErrorCode.PARAM_ERROR);
  }

  return await AppDataSource.transaction(async (manager) => {
    const booking = await manager.findOne(Booking, {
      where: { id: booking_id, member_id: memberId },
      relations: ['schedule'],
    });
    if (!booking) {
      return res.jsonFail(ErrorCode.BOOKING_NOT_FOUND);
    }

    if (booking.status === BookingStatus.CANCELLED) {
      return res.jsonFail(ErrorCode.BOOKING_ALREADY_CANCELLED);
    }
    if (booking.is_checked_in) {
      return res.jsonFail(ErrorCode.BOOKING_ALREADY_CHECKED_IN);
    }

    const scheduleStartTime = dayjs(booking.schedule.start_time);
    const hoursBeforeClass = scheduleStartTime.diff(dayjs(), 'hour', true);
    const threshold = Number(process.env.CANCEL_REFUND_THRESHOLD_HOURS || 24);

    let refundHours = 0;
    if (hoursBeforeClass >= threshold) {
      refundHours = Number((Number(booking.deducted_hours) / 2).toFixed(1));
    }

    if (refundHours > 0) {
      const member = await manager.findOne(Member, {
        where: { id: memberId },
        lock: { mode: 'pessimistic_write' },
      });
      if (member) {
        member.remaining_hours = Number(member.remaining_hours) + refundHours;
        member.used_hours = Math.max(
          0,
          Number(member.used_hours) - refundHours
        );
        await manager.save(member);

        const record = manager.create(CourseRecord, {
          member_id: memberId,
          booking_id: booking.id,
          type: RecordType.REFUND,
          hours_change: refundHours,
          remaining_after: Number(member.remaining_hours),
          remark: `取消课程退款${
            hoursBeforeClass >= threshold ? '(提前24h退50%)' : ''
          }`,
        });
        await manager.save(record);
      }
    }

    booking.status = BookingStatus.CANCELLED;
    booking.cancelled_at = new Date();
    booking.cancel_reason = reason || '';
    booking.refunded_hours = refundHours;
    await manager.save(booking);

    const schedule = await manager.findOne(Schedule, {
      where: { id: booking.schedule_id },
      relations: ['course'],
    });
    let waitlistFilled: any = null;

    if (schedule) {
      schedule.booked_count = Math.max(0, schedule.booked_count - 1);
      if (schedule.status === ScheduleStatus.FULL) {
        schedule.status = ScheduleStatus.AVAILABLE;
      }
      await manager.save(schedule);

      if (schedule.course?.type === CourseType.GROUP) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const nextWaiter = await manager.findOne(Waitlist, {
            where: {
              schedule_id: schedule.id,
              status: WaitlistStatus.QUEUED,
            },
            order: { joined_at: 'ASC' },
            lock: { mode: 'pessimistic_write' },
          });
          if (!nextWaiter) break;

          const waiterMember = await manager.findOne(Member, {
            where: { id: nextWaiter.member_id },
            lock: { mode: 'pessimistic_write' },
          });
          const costHours = Number(schedule.course?.cost_hours || 1);

          if (!waiterMember || Number(waiterMember.remaining_hours) < costHours) {
            nextWaiter.status = WaitlistStatus.EXPIRED;
            nextWaiter.cancelled_at = new Date();
            nextWaiter.cancel_reason = waiterMember
              ? '课时不足，自动跳过候补'
              : '会员账号异常，自动跳过候补';
            await manager.save(nextWaiter);
            continue;
          }

          const alreadyBooked = await manager.findOne(Booking, {
            where: {
              member_id: nextWaiter.member_id,
              schedule_id: schedule.id,
              status: In([BookingStatus.BOOKED, BookingStatus.COMPLETED]),
            },
          });
          if (alreadyBooked) {
            nextWaiter.status = WaitlistStatus.EXPIRED;
            nextWaiter.cancelled_at = new Date();
            nextWaiter.cancel_reason = '已主动预约成功';
            await manager.save(nextWaiter);
            continue;
          }

          waiterMember.remaining_hours = Number(waiterMember.remaining_hours) - costHours;
          waiterMember.used_hours = Number(waiterMember.used_hours) + costHours;
          await manager.save(waiterMember);

          const newBooking = manager.create(Booking, {
            member_id: nextWaiter.member_id,
            schedule_id: schedule.id,
            status: BookingStatus.BOOKED,
            deducted_hours: costHours,
            refunded_hours: 0,
          });
          await manager.save(newBooking);

          nextWaiter.status = WaitlistStatus.FILLED;
          nextWaiter.filled_at = new Date();
          nextWaiter.booking_id = newBooking.id;
          await manager.save(nextWaiter);

          schedule.booked_count = schedule.booked_count + 1;
          const maxCap = schedule.course?.max_capacity || 0;
          if (maxCap > 0 && schedule.booked_count >= maxCap) {
            schedule.status = ScheduleStatus.FULL;
          }
          await manager.save(schedule);

          const record = manager.create(CourseRecord, {
            member_id: nextWaiter.member_id,
            booking_id: newBooking.id,
            type: RecordType.DEDUCT,
            hours_change: -costHours,
            remaining_after: Number(waiterMember.remaining_hours),
            remark: `候补递补：${schedule.course?.name || '课程'}`,
          });
          await manager.save(record);

          waitlistFilled = {
            member_id: nextWaiter.member_id,
            booking_id: newBooking.id,
            deducted_hours: costHours,
          };
          break;
        }
      }
    }

    return res.jsonSuccess(
      {
        booking_id: booking.id,
        refunded_hours: refundHours,
        hours_before_class: Number(hoursBeforeClass.toFixed(1)),
        message:
          refundHours > 0
            ? `已退还${refundHours}课时`
            : '距开课不足24小时，不退课时',
        waitlist_auto_filled: waitlistFilled,
      },
      '取消成功'
    );
  });
}

export async function getMyBookings(req: Request, res: Response) {
  const memberId = req.user!.id;
  const { status, page = 1, pageSize = 20 } = req.query;

  const where: any = { member_id: memberId };
  if (status) {
    where.status = status;
  }

  const [bookings, total] = await bookingRepo().findAndCount({
    where,
    relations: ['schedule', 'schedule.course', 'schedule.coach'],
    order: { created_at: 'DESC' },
    skip: (Number(page) - 1) * Number(pageSize),
    take: Number(pageSize),
  });

  const list = bookings.map((b) => ({
    id: b.id,
    status: b.status,
    deducted_hours: Number(b.deducted_hours),
    refunded_hours: Number(b.refunded_hours),
    cancelled_at: b.cancelled_at,
    cancel_reason: b.cancel_reason,
    is_checked_in: b.is_checked_in,
    checked_in_at: b.checked_in_at,
    created_at: b.created_at,
    schedule: b.schedule
      ? {
          id: b.schedule.id,
          start_time: b.schedule.start_time,
          end_time: b.schedule.end_time,
          location: b.schedule.location,
          course_name: b.schedule.course?.name,
          course_type: b.schedule.course?.type,
          cost_hours: b.schedule.course?.cost_hours,
          coach_name: b.schedule.coach?.name,
          coach_avatar: b.schedule.coach?.avatar,
        }
      : null,
  }));

  return res.jsonSuccess({
    list,
    total,
    page: Number(page),
    pageSize: Number(pageSize),
  });
}

export async function joinWaitlist(req: Request, res: Response) {
  const memberId = req.user!.id;
  const { schedule_id } = req.body;

  if (!schedule_id) {
    return res.jsonFail(ErrorCode.PARAM_ERROR);
  }

  return await AppDataSource.transaction(async (manager) => {
    const schedule = await manager.findOne(Schedule, {
      where: { id: schedule_id },
      relations: ['course', 'coach'],
    });
    if (!schedule) {
      return res.jsonFail(ErrorCode.SCHEDULE_NOT_FOUND);
    }

    if (schedule.course?.type !== CourseType.GROUP) {
      return res.jsonFail(ErrorCode.WAITLIST_PRIVATE_NOT_ALLOWED);
    }

    if (schedule.status === ScheduleStatus.CANCELLED) {
      return res.jsonFail(ErrorCode.SCHEDULE_CANCELLED);
    }
    if (schedule.status === ScheduleStatus.COMPLETED) {
      return res.jsonFail(ErrorCode.SCHEDULE_COMPLETED);
    }
    if (dayjs(schedule.start_time).isBefore(dayjs())) {
      return res.jsonFail(ErrorCode.SCHEDULE_PAST);
    }

    const existingBooking = await manager.findOne(Booking, {
      where: {
        member_id: memberId,
        schedule_id: schedule_id,
        status: In([BookingStatus.BOOKED, BookingStatus.COMPLETED]),
      },
    });
    if (existingBooking) {
      return res.jsonFail(ErrorCode.BOOKING_ALREADY_EXISTS);
    }

    const existingWaitlist = await manager.findOne(Waitlist, {
      where: {
        member_id: memberId,
        schedule_id: schedule_id,
        status: WaitlistStatus.QUEUED,
      },
    });
    if (existingWaitlist) {
      return res.jsonFail(ErrorCode.WAITLIST_ALREADY_EXISTS);
    }

    const maxCap = schedule.course?.max_capacity || 0;
    if (maxCap <= 0 || schedule.booked_count < maxCap) {
      return res.jsonFail(ErrorCode.PARAM_ERROR, '该课程尚未满员，可直接约课');
    }

    const costHours = Number(schedule.course?.cost_hours || 1);
    const member = await manager.findOne(Member, { where: { id: memberId } });
    if (!member) {
      return res.jsonFail(ErrorCode.MEMBER_NOT_FOUND);
    }
    if (Number(member.remaining_hours) < costHours) {
      return res.jsonFail(ErrorCode.WAITLIST_HOURS_INSUFFICIENT);
    }

    if (schedule.coach) {
      const onLeave = await checkCoachOnLeave(
        schedule.coach_id,
        schedule.start_time,
        schedule.end_time
      );
      if (onLeave) {
        return res.jsonFail(ErrorCode.COACH_ON_LEAVE);
      }
    }

    const waitlist = manager.create(Waitlist, {
      member_id: memberId,
      schedule_id: schedule_id,
      status: WaitlistStatus.QUEUED,
    });
    await manager.save(waitlist);

    const queuedCount = await manager.count(Waitlist, {
      where: {
        schedule_id: schedule_id,
        status: WaitlistStatus.QUEUED,
      },
    });

    return res.jsonSuccess(
      {
        waitlist_id: waitlist.id,
        schedule_id: schedule.id,
        course_name: schedule.course?.name,
        start_time: schedule.start_time,
        joined_at: waitlist.joined_at,
        queue_position: queuedCount,
        total_queued: queuedCount,
      },
      '已加入候补队列，有空位将自动为您预约'
    );
  });
}

export async function cancelWaitlist(req: Request, res: Response) {
  const memberId = req.user!.id;
  const { waitlist_id, reason } = req.body;

  if (!waitlist_id) {
    return res.jsonFail(ErrorCode.PARAM_ERROR);
  }

  return await AppDataSource.transaction(async (manager) => {
    const waitlist = await manager.findOne(Waitlist, {
      where: { id: waitlist_id, member_id: memberId },
    });
    if (!waitlist) {
      return res.jsonFail(ErrorCode.WAITLIST_NOT_FOUND);
    }
    if (waitlist.status !== WaitlistStatus.QUEUED) {
      return res.jsonFail(ErrorCode.WAITLIST_NOT_QUEUED);
    }

    waitlist.status = WaitlistStatus.CANCELLED;
    waitlist.cancelled_at = new Date();
    waitlist.cancel_reason = reason || '会员主动取消候补';
    await manager.save(waitlist);

    return res.jsonSuccess(
      {
        waitlist_id: waitlist.id,
        cancelled_at: waitlist.cancelled_at,
      },
      '已退出候补队列'
    );
  });
}

export async function getMyWaitlists(req: Request, res: Response) {
  const memberId = req.user!.id;
  const { status, page = 1, pageSize = 20 } = req.query;

  const where: any = { member_id: memberId };
  if (status) {
    where.status = status;
  }

  const [waitlists, total] = await waitlistRepo().findAndCount({
    where,
    relations: ['schedule', 'schedule.course', 'schedule.coach'],
    order: { joined_at: 'DESC' },
    skip: (Number(page) - 1) * Number(pageSize),
    take: Number(pageSize),
  });

  const list = await Promise.all(
    waitlists.map(async (w) => {
      let queue_position: number | null = null;
      if (w.status === WaitlistStatus.QUEUED) {
        queue_position = await waitlistRepo()
          .createQueryBuilder('wl')
          .where('wl.schedule_id = :sid', { sid: w.schedule_id })
          .andWhere('wl.status = :st', { st: WaitlistStatus.QUEUED })
          .andWhere('wl.joined_at <= :t', { t: w.joined_at })
          .getCount();
      }

      return {
        id: w.id,
        status: w.status,
        joined_at: w.joined_at,
        filled_at: w.filled_at,
        cancelled_at: w.cancelled_at,
        cancel_reason: w.cancel_reason,
        booking_id: w.booking_id,
        queue_position,
        schedule: w.schedule
          ? {
              id: w.schedule.id,
              start_time: w.schedule.start_time,
              end_time: w.schedule.end_time,
              location: w.schedule.location,
              course_name: w.schedule.course?.name,
              course_type: w.schedule.course?.type,
              cost_hours: w.schedule.course?.cost_hours,
              coach_name: w.schedule.coach?.name,
              coach_avatar: w.schedule.coach?.avatar,
              schedule_status: w.schedule.status,
            }
          : null,
      };
    })
  );

  return res.jsonSuccess({
    list,
    total,
    page: Number(page),
    pageSize: Number(pageSize),
  });
}
