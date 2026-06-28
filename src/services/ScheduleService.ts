import { AppDataSource } from '../data-source';
import { Schedule, ScheduleStatus } from '../entities/Schedule';
import { Coach, CoachStatus } from '../entities/Coach';
import { Course } from '../entities/Course';
import { CoachLeave, LeaveStatus } from '../entities/CoachLeave';
import { ErrorCode } from '../constants/error-code';
import { throwError } from '../utils/app-error';
import dayjs = require('dayjs');

export class ScheduleService {
  static async checkCoachTimeConflict(
    coachId: number,
    startTime: Date,
    endTime: Date,
    excludeScheduleId?: number
  ): Promise<boolean> {
    const scheduleRepo = AppDataSource.getRepository(Schedule);
    const qb = scheduleRepo
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

  static async checkCoachOnLeave(
    coachId: number,
    startTime: Date,
    endTime: Date
  ): Promise<boolean> {
    const leaveRepo = AppDataSource.getRepository(CoachLeave);
    const leaveDate = dayjs(startTime).format('YYYY-MM-DD');
    const leave = await leaveRepo.findOne({
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

  static async createSchedule(params: {
    coach_id: number;
    course_id: number;
    start_time: string | Date;
    end_time: string | Date;
    location?: string;
  }): Promise<Schedule> {
    const { coach_id, course_id, start_time, end_time, location } = params;

    if (!coach_id || !course_id || !start_time || !end_time) {
      throwError(ErrorCode.PARAM_ERROR);
    }

    const coachRepo = AppDataSource.getRepository(Coach);
    const courseRepo = AppDataSource.getRepository(Course);
    const scheduleRepo = AppDataSource.getRepository(Schedule);

    const coach = await coachRepo.findOne({ where: { id: coach_id } });
    if (!coach) throwError(ErrorCode.COACH_NOT_FOUND);
    if (coach.status === CoachStatus.INACTIVE) throwError(ErrorCode.COACH_INACTIVE);

    const course = await courseRepo.findOne({ where: { id: course_id } });
    if (!course) throwError(ErrorCode.COURSE_NOT_FOUND);
    if (!course.is_active) throwError(ErrorCode.COURSE_INACTIVE);

    const startTime = new Date(start_time);
    const endTime = new Date(end_time);

    if (startTime >= endTime) {
      throwError(ErrorCode.PARAM_ERROR, '结束时间必须晚于开始时间');
    }

    const hasConflict = await ScheduleService.checkCoachTimeConflict(
      coach_id,
      startTime,
      endTime
    );
    if (hasConflict) throwError(ErrorCode.SCHEDULE_TIME_CONFLICT);

    const onLeave = await ScheduleService.checkCoachOnLeave(
      coach_id,
      startTime,
      endTime
    );
    if (onLeave) throwError(ErrorCode.COACH_ON_LEAVE);

    const schedule = scheduleRepo.create({
      coach_id,
      course_id,
      start_time: startTime,
      end_time: endTime,
      location: location || '',
      status: ScheduleStatus.AVAILABLE,
      booked_count: 0,
    });

    return await scheduleRepo.save(schedule);
  }

  static async findScheduleWithRelations(scheduleId: number, manager?: any) {
    const repo = manager || AppDataSource.getRepository(Schedule);
    return await repo.findOne(Schedule, {
      where: { id: scheduleId },
      relations: ['course', 'coach'],
    });
  }
}
