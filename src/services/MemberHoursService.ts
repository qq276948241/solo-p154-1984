import { EntityManager } from 'typeorm';
import { Member } from '../entities/Member';
import { CourseRecord, RecordType } from '../entities/CourseRecord';
import { ErrorCode } from '../constants/error-code';
import { throwError } from '../utils/app-error';

export interface HoursChangeResult {
  member_id: number;
  remaining_hours: number;
  used_hours: number;
  hours_change: number;
  record_id: number;
}

export class MemberHoursService {
  static async deduct(
    manager: EntityManager,
    memberId: number,
    hours: number,
    options: {
      booking_id?: number;
      remark?: string;
    } = {}
  ): Promise<HoursChangeResult> {
    if (hours <= 0) {
      throwError(ErrorCode.PARAM_ERROR, '扣除课时必须大于0');
    }
    const change = -Math.abs(Number(hours.toFixed(1)));
    return await MemberHoursService._change(manager, memberId, change, {
      ...options,
      recordType: RecordType.DEDUCT,
      enforceBalance: true,
    });
  }

  static async refund(
    manager: EntityManager,
    memberId: number,
    hours: number,
    options: {
      booking_id?: number;
      remark?: string;
    } = {}
  ): Promise<HoursChangeResult> {
    if (hours <= 0) {
      throwError(ErrorCode.PARAM_ERROR, '退还课时必须大于0');
    }
    const change = Math.abs(Number(hours.toFixed(1)));
    return await MemberHoursService._change(manager, memberId, change, {
      ...options,
      recordType: RecordType.REFUND,
      enforceBalance: false,
    });
  }

  private static async _change(
    manager: EntityManager,
    memberId: number,
    hoursChange: number,
    options: {
      booking_id?: number;
      remark?: string;
      recordType: RecordType;
      enforceBalance: boolean;
    }
  ): Promise<HoursChangeResult> {
    const memberRepo = manager.getRepository(Member);

    const member = await memberRepo
      .createQueryBuilder('m')
      .where('m.id = :id', { id: memberId })
      .setLock('pessimistic_write')
      .getOne();

    if (!member) {
      throwError(ErrorCode.MEMBER_NOT_FOUND);
    }

    const currentRemaining = Number(member.remaining_hours);

    if (options.enforceBalance && currentRemaining + hoursChange < 0) {
      throwError(ErrorCode.MEMBER_HOURS_INSUFFICIENT);
    }

    const changeStr = hoursChange >= 0 ? `+ ${hoursChange}` : `- ${Math.abs(hoursChange)}`;
    const absStr = String(Math.abs(hoursChange));

    await memberRepo
      .createQueryBuilder()
      .update()
      .set({
        remaining_hours: () => `remaining_hours ${changeStr}`,
        used_hours: () =>
          hoursChange < 0
            ? `used_hours + ${absStr}`
            : `GREATEST(used_hours - ${absStr}, 0)`,
      })
      .where('id = :id', { id: memberId })
      .execute();

    const refreshed = await memberRepo
      .createQueryBuilder('m')
      .where('m.id = :id', { id: memberId })
      .setLock('pessimistic_write')
      .getOne();

    if (!refreshed) {
      throwError(ErrorCode.MEMBER_NOT_FOUND);
    }

    const record = manager.create(CourseRecord, {
      member_id: memberId,
      booking_id: options.booking_id,
      type: options.recordType,
      hours_change: hoursChange,
      remaining_after: Number(refreshed.remaining_hours),
      remark: options.remark || '',
    });
    const savedRecord = await manager.save(record);

    return {
      member_id: memberId,
      remaining_hours: Number(refreshed.remaining_hours),
      used_hours: Number(refreshed.used_hours),
      hours_change: hoursChange,
      record_id: Number(savedRecord.id),
    };
  }
}
