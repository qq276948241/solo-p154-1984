import { AppDataSource } from '../data-source';
import { EntityManager, In } from 'typeorm';
import { Schedule, ScheduleStatus } from '../entities/Schedule';
import { Booking, BookingStatus } from '../entities/Booking';
import { Member } from '../entities/Member';
import { Course, CourseType } from '../entities/Course';
import { CourseRecord, RecordType } from '../entities/CourseRecord';
import { Waitlist, WaitlistStatus } from '../entities/Waitlist';
import { ErrorCode } from '../constants/error-code';
import { throwError } from '../utils/app-error';
import { ScheduleService } from './ScheduleService';
import dayjs = require('dayjs');

export interface WaitlistAutoFillResult {
  member_id: number;
  booking_id: number;
  deducted_hours: number;
}

export class WaitlistService {
  static async joinWaitlist(
    memberId: number,
    scheduleId: number
  ): Promise<{
    waitlist_id: number;
    schedule_id: number;
    course_name: string | undefined;
    start_time: Date;
    joined_at: Date;
    queue_position: number;
    total_queued: number;
  }> {
    if (!scheduleId) throwError(ErrorCode.PARAM_ERROR);

    return await AppDataSource.transaction(async (manager) => {
      const schedule = await ScheduleService.findScheduleWithRelations(
        scheduleId,
        manager
      );
      if (!schedule) throwError(ErrorCode.SCHEDULE_NOT_FOUND);

      if (schedule.course?.type !== CourseType.GROUP) {
        throwError(ErrorCode.WAITLIST_PRIVATE_NOT_ALLOWED);
      }

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

      const existingWaitlist = await manager.findOne(Waitlist, {
        where: {
          member_id: memberId,
          schedule_id: scheduleId,
          status: WaitlistStatus.QUEUED,
        },
      });
      if (existingWaitlist) throwError(ErrorCode.WAITLIST_ALREADY_EXISTS);

      const maxCap = schedule.course?.max_capacity || 0;
      if (maxCap <= 0 || schedule.booked_count < maxCap) {
        throwError(ErrorCode.PARAM_ERROR, '该课程尚未满员，可直接约课');
      }

      const costHours = Number(schedule.course?.cost_hours || 1);
      const member = await manager.findOne(Member, { where: { id: memberId } });
      if (!member) throwError(ErrorCode.MEMBER_NOT_FOUND);
      if (Number(member.remaining_hours) < costHours) {
        throwError(ErrorCode.WAITLIST_HOURS_INSUFFICIENT);
      }

      if (schedule.coach) {
        const onLeave = await ScheduleService.checkCoachOnLeave(
          schedule.coach_id,
          schedule.start_time,
          schedule.end_time
        );
        if (onLeave) throwError(ErrorCode.COACH_ON_LEAVE);
      }

      const waitlist = manager.create(Waitlist, {
        member_id: memberId,
        schedule_id: scheduleId,
        status: WaitlistStatus.QUEUED,
      });
      await manager.save(waitlist);

      const queuedCount = await manager.count(Waitlist, {
        where: {
          schedule_id: scheduleId,
          status: WaitlistStatus.QUEUED,
        },
      });

      return {
        waitlist_id: waitlist.id,
        schedule_id: schedule.id,
        course_name: schedule.course?.name,
        start_time: schedule.start_time,
        joined_at: waitlist.joined_at,
        queue_position: queuedCount,
        total_queued: queuedCount,
      };
    });
  }

  static async cancelWaitlist(
    memberId: number,
    waitlistId: number,
    reason?: string
  ): Promise<{
    waitlist_id: number;
    cancelled_at: Date;
  }> {
    if (!waitlistId) throwError(ErrorCode.PARAM_ERROR);

    return await AppDataSource.transaction(async (manager) => {
      const waitlist = await manager.findOne(Waitlist, {
        where: { id: waitlistId, member_id: memberId },
      });
      if (!waitlist) throwError(ErrorCode.WAITLIST_NOT_FOUND);
      if (waitlist.status !== WaitlistStatus.QUEUED) {
        throwError(ErrorCode.WAITLIST_NOT_QUEUED);
      }

      waitlist.status = WaitlistStatus.CANCELLED;
      waitlist.cancelled_at = new Date();
      waitlist.cancel_reason = reason || '会员主动取消候补';
      await manager.save(waitlist);

      return {
        waitlist_id: waitlist.id,
        cancelled_at: waitlist.cancelled_at,
      };
    });
  }

  static async getMyWaitlists(
    memberId: number,
    status?: string,
    page: number = 1,
    pageSize: number = 20
  ): Promise<{
    list: any[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const waitlistRepo = AppDataSource.getRepository(Waitlist);
    const where: any = { member_id: memberId };
    if (status) where.status = status;

    const [waitlists, total] = await waitlistRepo.findAndCount({
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
          queue_position = await waitlistRepo
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

    return { list, total, page: Number(page), pageSize: Number(pageSize) };
  }

  static async autoFillFromWaitlist(
    manager: EntityManager,
    schedule: Schedule & { course?: Course | null }
  ): Promise<WaitlistAutoFillResult | null> {
    if (!schedule.course || schedule.course.type !== CourseType.GROUP) {
      return null;
    }

    let filled: WaitlistAutoFillResult | null = null;

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

      waiterMember.remaining_hours =
        Number(waiterMember.remaining_hours) - costHours;
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

      filled = {
        member_id: nextWaiter.member_id,
        booking_id: newBooking.id,
        deducted_hours: costHours,
      };
      break;
    }

    return filled;
  }
}
