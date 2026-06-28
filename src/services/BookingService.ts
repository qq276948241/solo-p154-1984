import { AppDataSource } from '../data-source';
import { In } from 'typeorm';
import { Schedule, ScheduleStatus } from '../entities/Schedule';
import { Booking, BookingStatus } from '../entities/Booking';
import { Member } from '../entities/Member';
import { CourseType } from '../entities/Course';
import { CourseRecord, RecordType } from '../entities/CourseRecord';
import { Waitlist, WaitlistStatus } from '../entities/Waitlist';
import { ErrorCode } from '../constants/error-code';
import { throwError } from '../utils/app-error';
import { ScheduleService } from './ScheduleService';
import {
  WaitlistService,
  WaitlistAutoFillResult,
} from './WaitlistService';
import dayjs = require('dayjs');

export interface BookResult {
  booking_id: number;
  deducted_hours: number;
  remaining_hours: number;
}

export interface CancelResult {
  booking_id: number;
  refunded_hours: number;
  hours_before_class: number;
  message: string;
  waitlist_auto_filled: WaitlistAutoFillResult | null;
}

export interface MyBookingsResult {
  list: any[];
  total: number;
  page: number;
  pageSize: number;
}

export class BookingService {
  static async bookCourse(
    memberId: number,
    scheduleId: number
  ): Promise<BookResult> {
    if (!scheduleId) throwError(ErrorCode.PARAM_ERROR);

    return await AppDataSource.transaction(async (manager) => {
      const schedule = await ScheduleService.findScheduleWithRelations(
        scheduleId,
        manager
      );
      if (!schedule) throwError(ErrorCode.SCHEDULE_NOT_FOUND);

      if (schedule.status === ScheduleStatus.CANCELLED) {
        throwError(ErrorCode.SCHEDULE_CANCELLED);
      }
      if (schedule.status === ScheduleStatus.COMPLETED) {
        throwError(ErrorCode.SCHEDULE_COMPLETED);
      }
      if (dayjs(schedule.start_time).isBefore(dayjs())) {
        throwError(ErrorCode.SCHEDULE_PAST);
      }

      const existingBooking = await manager.findOne(Booking, {
        where: {
          member_id: memberId,
          schedule_id: scheduleId,
          status: In([BookingStatus.BOOKED, BookingStatus.COMPLETED]),
        },
      });
      if (existingBooking) throwError(ErrorCode.BOOKING_ALREADY_EXISTS);

      if (schedule.coach) {
        const onLeave = await ScheduleService.checkCoachOnLeave(
          schedule.coach_id,
          schedule.start_time,
          schedule.end_time
        );
        if (onLeave) throwError(ErrorCode.COACH_ON_LEAVE);
      }

      const costHours = Number(schedule.course?.cost_hours || 1);

      const member = await manager.findOne(Member, {
        where: { id: memberId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!member) throwError(ErrorCode.MEMBER_NOT_FOUND);

      if (Number(member.remaining_hours) < costHours) {
        throwError(ErrorCode.MEMBER_HOURS_INSUFFICIENT);
      }

      if (schedule.course?.type === CourseType.PRIVATE) {
        const hasConflict = await ScheduleService.checkCoachTimeConflict(
          schedule.coach_id,
          schedule.start_time,
          schedule.end_time,
          schedule.id
        );
        if (hasConflict) throwError(ErrorCode.SCHEDULE_TIME_CONFLICT);
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
          throwError(ErrorCode.WAITLIST_FULL_PROMPT, undefined, {
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
        schedule_id: scheduleId,
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

      return {
        booking_id: booking.id,
        deducted_hours: costHours,
        remaining_hours: Number(member.remaining_hours),
      };
    });
  }

  static async cancelBooking(
    memberId: number,
    bookingId: number,
    reason?: string
  ): Promise<CancelResult> {
    if (!bookingId) throwError(ErrorCode.PARAM_ERROR);

    return await AppDataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, {
        where: { id: bookingId, member_id: memberId },
        relations: ['schedule'],
      });
      if (!booking) throwError(ErrorCode.BOOKING_NOT_FOUND);

      if (booking.status === BookingStatus.CANCELLED) {
        throwError(ErrorCode.BOOKING_ALREADY_CANCELLED);
      }
      if (booking.is_checked_in) {
        throwError(ErrorCode.BOOKING_ALREADY_CHECKED_IN);
      }

      const scheduleStartTime = dayjs(booking.schedule.start_time);
      const hoursBeforeClass = scheduleStartTime.diff(dayjs(), 'hour', true);
      const threshold = Number(
        process.env.CANCEL_REFUND_THRESHOLD_HOURS || 24
      );

      let refundHours = 0;
      if (hoursBeforeClass >= threshold) {
        refundHours = Number(
          (Number(booking.deducted_hours) / 2).toFixed(1)
        );
      }

      if (refundHours > 0) {
        const member = await manager.findOne(Member, {
          where: { id: memberId },
          lock: { mode: 'pessimistic_write' },
        });
        if (member) {
          member.remaining_hours =
            Number(member.remaining_hours) + refundHours;
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

      let waitlistFilled: WaitlistAutoFillResult | null = null;

      const schedule = await manager.findOne(Schedule, {
        where: { id: booking.schedule_id },
        relations: ['course'],
      });

      if (schedule) {
        schedule.booked_count = Math.max(0, schedule.booked_count - 1);
        if (schedule.status === ScheduleStatus.FULL) {
          schedule.status = ScheduleStatus.AVAILABLE;
        }
        await manager.save(schedule);

        waitlistFilled = await WaitlistService.autoFillFromWaitlist(
          manager,
          schedule as any
        );
      }

      const refundMessage =
        refundHours > 0
          ? `已退还${refundHours}课时`
          : '距开课不足24小时，不退课时';

      return {
        booking_id: booking.id,
        refunded_hours: refundHours,
        hours_before_class: Number(hoursBeforeClass.toFixed(1)),
        message: refundMessage,
        waitlist_auto_filled: waitlistFilled,
      };
    });
  }

  static async getMyBookings(
    memberId: number,
    status?: string,
    page: number = 1,
    pageSize: number = 20
  ): Promise<MyBookingsResult> {
    const bookingRepo = AppDataSource.getRepository(Booking);
    const where: any = { member_id: memberId };
    if (status) where.status = status;

    const [bookings, total] = await bookingRepo.findAndCount({
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

    return {
      list,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    };
  }
}
