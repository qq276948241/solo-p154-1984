import { AppDataSource } from '../data-source';
import { In } from 'typeorm';
import { Schedule, ScheduleStatus } from '../entities/Schedule';
import { Booking, BookingStatus } from '../entities/Booking';
import { Member } from '../entities/Member';
import { CourseType } from '../entities/Course';
import { Waitlist, WaitlistStatus } from '../entities/Waitlist';
import { ErrorCode } from '../constants/error-code';
import { throwError } from '../utils/app-error';
import { ScheduleService } from './ScheduleService';
import {
  WaitlistService,
  WaitlistAutoFillResult,
} from './WaitlistService';
import { MemberHoursService } from './MemberHoursService';
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

      const costHours = Number(
        Number(schedule.course?.cost_hours || 1).toFixed(1)
      );

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

      const member = await manager.findOne(Member, {
        where: { id: memberId },
      });
      if (!member) throwError(ErrorCode.MEMBER_NOT_FOUND);

      const booking = manager.create(Booking, {
        member_id: memberId,
        schedule_id: scheduleId,
        status: BookingStatus.BOOKED,
        deducted_hours: costHours,
        refunded_hours: 0,
      });
      await manager.save(booking);

      const hoursResult = await MemberHoursService.deduct(
        manager,
        memberId,
        costHours,
        {
          booking_id: booking.id,
          remark: `预约${schedule.course?.name || '课程'}`,
        }
      );

      await manager
        .createQueryBuilder()
        .update(Schedule)
        .set({ booked_count: () => 'booked_count + 1' })
        .where('id = :id', { id: scheduleId })
        .execute();

      if (schedule.course?.type === CourseType.GROUP) {
        const maxCap = schedule.course?.max_capacity || 0;
        if (maxCap > 0) {
          const refreshed = await manager
            .getRepository(Schedule)
            .createQueryBuilder('s')
            .where('s.id = :id', { id: scheduleId })
            .setLock('pessimistic_write')
            .getOne();
          if (refreshed && refreshed.booked_count >= maxCap) {
            refreshed.status = ScheduleStatus.FULL;
            await manager.save(refreshed);
          }
        }
      }

      return {
        booking_id: booking.id,
        deducted_hours: costHours,
        remaining_hours: hoursResult.remaining_hours,
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
        relations: ['schedule', 'schedule.course'],
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

      const deducted = Number(Number(booking.deducted_hours).toFixed(1));
      let refundHours = 0;
      if (hoursBeforeClass >= threshold && deducted > 0) {
        refundHours = Number((deducted / 2).toFixed(1));
        if (refundHours < 0) refundHours = 0;
        if (refundHours > deducted) refundHours = deducted;
      }

      if (refundHours > 0) {
        await MemberHoursService.refund(manager, memberId, refundHours, {
          booking_id: bookingId,
          remark: `取消课程退款(提前24h退50%)`,
        });
      }

      await manager
        .createQueryBuilder()
        .update(Booking)
        .set({
          status: BookingStatus.CANCELLED,
          cancelled_at: new Date(),
          cancel_reason: reason || '',
          refunded_hours: refundHours,
        })
        .where('id = :id', { id: bookingId })
        .execute();

      await manager
        .createQueryBuilder()
        .update(Schedule)
        .set({
          booked_count: () => 'GREATEST(booked_count - 1, 0)',
          status:
            booking.schedule.status === ScheduleStatus.FULL
              ? `'${ScheduleStatus.AVAILABLE}'`
              : undefined,
        })
        .where('id = :id', { id: booking.schedule_id })
        .execute();

      const schedule = await manager
        .getRepository(Schedule)
        .createQueryBuilder('s')
        .leftJoinAndSelect('s.course', 'course')
        .where('s.id = :id', { id: booking.schedule_id })
        .setLock('pessimistic_write')
        .getOne();

      let waitlistFilled: WaitlistAutoFillResult | null = null;
      if (schedule && schedule.course) {
        waitlistFilled = await WaitlistService.autoFillFromWaitlist(
          manager,
          schedule
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
