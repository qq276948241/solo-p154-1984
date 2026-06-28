import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import dayjs = require('dayjs');
import bcrypt = require('bcryptjs');

import {
  Member,
  MemberStatus,
} from '../src/entities/Member';
import { Coach, CoachStatus } from '../src/entities/Coach';
import { Course, CourseType } from '../src/entities/Course';
import {
  Schedule,
  ScheduleStatus,
} from '../src/entities/Schedule';
import { Booking, BookingStatus } from '../src/entities/Booking';
import {
  CourseRecord,
  RecordType,
} from '../src/entities/CourseRecord';
import { CoachLeave } from '../src/entities/CoachLeave';
import {
  Waitlist,
  WaitlistStatus,
} from '../src/entities/Waitlist';

import { ErrorCode } from '../src/constants/error-code';
import { BookingService } from '../src/services/BookingService';
import { WaitlistService } from '../src/services/WaitlistService';
import { ScheduleService } from '../src/services/ScheduleService';

dotenv.config();

let DS: DataSource;
let uid = 0;
function tag(prefix: string) {
  uid += 1;
  return `${prefix}-${Date.now()}-${uid}`;
}

async function ensureDS() {
  if (DS) return;
  DS = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    synchronize: true,
    logging: false,
    entities: [
      Member,
      Coach,
      Course,
      Schedule,
      Booking,
      CourseRecord,
      CoachLeave,
      Waitlist,
    ],
    migrations: [],
    subscribers: [],
    timezone: '+08:00',
    dateStrings: true,
  });
  await DS.initialize();
}

function assertEq<T>(actual: T, expected: T, msg: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    throw new Error(
      `断言失败: ${msg}; 期望=${JSON.stringify(
        expected
      )}, 实际=${JSON.stringify(actual)}`
    );
  }
  console.log(`  ✅ ${msg}`);
}

function assertApprox(
  actual: number,
  expected: number,
  msg: string,
  eps = 0.1
) {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(
      `断言失败: ${msg}; 期望≈${expected}, 实际=${actual}`
    );
  }
  console.log(`  ✅ ${msg}`);
}

async function createMember(
  hours: number = 50,
  nickname?: string
): Promise<Member> {
  const repo = DS.getRepository(Member);
  const m = repo.create({
    phone: tag('139'),
    password: bcrypt.hashSync('Test123456', 8),
    nickname: nickname || tag('m'),
    remaining_hours: hours,
    used_hours: 0,
    status: MemberStatus.ACTIVE,
  });
  return await repo.save(m);
}

async function createCoach(): Promise<Coach> {
  const repo = DS.getRepository(Coach);
  const c = repo.create({
    phone: tag('138'),
    password: bcrypt.hashSync('Test123456', 8),
    name: tag('教练'),
    status: CoachStatus.ACTIVE,
  });
  return await repo.save(c);
}

async function createGroupCourse(
  cost: number = 2,
  cap: number = 1
): Promise<Course> {
  const repo = DS.getRepository(Course);
  const c = repo.create({
    name: tag('团课'),
    type: CourseType.GROUP,
    duration_minutes: 60,
    cost_hours: cost,
    max_capacity: cap,
    is_active: 1,
  });
  return await repo.save(c);
}

async function createSchedule(
  coach: Coach,
  course: Course,
  start: dayjs.Dayjs,
  booked: number = 0,
  status: ScheduleStatus = ScheduleStatus.AVAILABLE
): Promise<Schedule> {
  const repo = DS.getRepository(Schedule);
  const end = start.add(course.duration_minutes, 'minute');
  const s = repo.create({
    coach_id: coach.id,
    course_id: course.id,
    start_time: start.toDate(),
    end_time: end.toDate(),
    booked_count: booked,
    status,
    location: 'A教室',
  });
  return await repo.save(s);
}

async function getHours(memberId: number) {
  const m = await DS.getRepository(Member).findOne({
    where: { id: memberId },
  });
  return {
    remaining: Number(m!.remaining_hours),
    used: Number(m!.used_hours),
  };
}

async function catchCode(fn: () => Promise<any>): Promise<{
  code: number;
  data?: any;
  message?: string;
}> {
  try {
    await fn();
    return { code: 0 };
  } catch (e: any) {
    return {
      code: Number(e.code || e.statusCode || 0),
      data: e.data,
      message: e.message,
    };
  }
}

async function test1_cancel_over_24h_refund_half() {
  console.log('\n[测试1] 提前>24h取消，退一半课时');
  const coach = await createCoach();
  const course = await createGroupCourse(2, 5);
  const future = dayjs().add(2, 'day');
  const schedule = await createSchedule(coach, course, future);
  const m = await createMember(20);

  const before = await getHours(m.id);
  const book = await BookingService.bookCourse(m.id, schedule.id);
  assertEq(book.deducted_hours, 2, '预约扣2课时');
  const afterBook = await getHours(m.id);
  assertApprox(afterBook.remaining, before.remaining - 2, '预约后剩余课时正确');

  const result = await BookingService.cancelBooking(m.id, book.booking_id);
  assertApprox(result.refunded_hours, 1, '退款1课时(退半)');
  assertApprox(result.hours_before_class, 48, '距开课约48小时', 2);
  const afterCancel = await getHours(m.id);
  assertApprox(afterCancel.remaining, before.remaining - 1, '最终剩余课时=初始-1');
  assertApprox(afterCancel.used, before.used + 1, '最终消耗课时=初始+1');
}

async function test2_cancel_less_24h_no_refund() {
  console.log('\n[测试2] 提前<24h取消，不退课时');
  const coach = await createCoach();
  const course = await createGroupCourse(2, 5);
  const future = dayjs().add(2, 'hour');
  const schedule = await createSchedule(coach, course, future);
  const m = await createMember(20);

  const before = await getHours(m.id);
  const book = await BookingService.bookCourse(m.id, schedule.id);
  const result = await BookingService.cancelBooking(m.id, book.booking_id);
  assertEq(result.refunded_hours, 0, '退款0课时');
  const after = await getHours(m.id);
  assertApprox(after.remaining, before.remaining - 2, '不退课时，剩余-2');
}

async function test3_cancel_triggers_waitlist_autofill() {
  console.log('\n[测试3] 取消→候补自动递补，课时扣减正确');
  const coach = await createCoach();
  const course = await createGroupCourse(2, 1);
  const future = dayjs().add(2, 'day');
  const schedule = await createSchedule(coach, course, future);

  const memberA = await createMember(20);
  const memberB = await createMember(20);

  const bookA = await BookingService.bookCourse(memberA.id, schedule.id);
  assertEq(bookA.remaining_hours, 18, 'A剩余18');

  const wlCode = await catchCode(() =>
    BookingService.bookCourse(memberB.id, schedule.id)
  );
  assertEq(wlCode.code, ErrorCode.WAITLIST_FULL_PROMPT, 'B约课返回满员提示');

  const wlB = await WaitlistService.joinWaitlist(
    memberB.id,
    schedule.id
  );
  assertEq(wlB.total_queued, 1, 'B在候补队列第1');

  const BBefore = await getHours(memberB.id);
  const cancelA = await BookingService.cancelBooking(
    memberA.id,
    bookA.booking_id
  );
  assertEq(
    cancelA.waitlist_auto_filled!.member_id,
    memberB.id,
    '候补递补为会员B'
  );

  const BAfter = await getHours(memberB.id);
  assertApprox(BAfter.remaining, BBefore.remaining - 2, 'B被递补后扣2课时');
  assertApprox(BAfter.used, BBefore.used + 2, 'B used+2');

  const filled = await DS.getRepository(Waitlist).findOne({
    where: { id: wlB.waitlist_id },
  });
  assertEq(filled!.status, WaitlistStatus.FILLED, '候补状态为filled');
  assertEq(
    filled!.booking_id,
    cancelA.waitlist_auto_filled!.booking_id,
    '候补关联booking_id正确'
  );

  const bookingB = await DS.getRepository(Booking).findOne({
    where: { id: cancelA.waitlist_auto_filled!.booking_id },
  });
  assertEq(bookingB!.member_id, memberB.id, '递补生成的booking会员B');
  assertEq(bookingB!.status, BookingStatus.BOOKED, '递补booking状态booked');

  const refreshedSchedule = await DS
    .getRepository(Schedule)
    .findOne({ where: { id: schedule.id } });
  assertEq(refreshedSchedule!.booked_count, 1, '排课booked_count恢复1');
  assertEq(
    refreshedSchedule!.status,
    ScheduleStatus.FULL,
    '排课状态变回满员'
  );
}

async function test4_cancel_filled_waitlist_returns_booking_id() {
  console.log('\n[测试4] 取消filled状态的候补，返回80008+booking_id');
  const coach = await createCoach();
  const course = await createGroupCourse(2, 1);
  const future = dayjs().add(2, 'day');
  const schedule = await createSchedule(coach, course, future);

  const memberA = await createMember(20);
  const memberB = await createMember(20);

  const bookA = await BookingService.bookCourse(memberA.id, schedule.id);
  const wlB = await WaitlistService.joinWaitlist(
    memberB.id,
    schedule.id
  );
  await BookingService.cancelBooking(memberA.id, bookA.booking_id);

  const err = await catchCode(() =>
    WaitlistService.cancelWaitlist(memberB.id, wlB.waitlist_id)
  );
  assertEq(err.code, ErrorCode.WAITLIST_ALREADY_FILLED, '错误码80008');
  assertEq(
    typeof err.data?.booking_id === 'number',
    true,
    'data里带booking_id'
  );
  assertEq(
    typeof err.data?.tip === 'string' && err.data.tip.length > 0,
    true,
    'data里带tip提示'
  );
}

async function test5_cancel_already_cancelled_or_expired_waitlist() {
  console.log('\n[测试5] 取消已取消/已过期的候补，明确错误码');
  const coach = await createCoach();
  const course = await createGroupCourse(2, 3);
  const future = dayjs().add(2, 'day');
  const schedule = await createSchedule(coach, course, future);

  const memberA = await createMember(20);
  const memberB = await createMember(20);

  await BookingService.bookCourse(memberA.id, schedule.id);
  const wlB = await WaitlistService.joinWaitlist(
    memberB.id,
    schedule.id
  );
  await WaitlistService.cancelWaitlist(memberB.id, wlB.waitlist_id);

  const err1 = await catchCode(() =>
    WaitlistService.cancelWaitlist(memberB.id, wlB.waitlist_id)
  );
  assertEq(err1.code, ErrorCode.WAITLIST_ALREADY_CANCELLED, '已取消返回80009');
  assertEq(
    typeof err1.data?.cancelled_at !== 'undefined',
    true,
    '返回cancelled_at'
  );

  const waitlistRepo = DS.getRepository(Waitlist);
  const wlExpired = waitlistRepo.create({
    member_id: memberB.id,
    schedule_id: schedule.id,
    status: WaitlistStatus.EXPIRED,
    cancelled_at: new Date(),
    cancel_reason: '课时不足',
  });
  await waitlistRepo.save(wlExpired);

  const err2 = await catchCode(() =>
    WaitlistService.cancelWaitlist(memberB.id, wlExpired.id)
  );
  assertEq(err2.code, ErrorCode.WAITLIST_ALREADY_EXPIRED, '已过期返回80010');
}

async function test6_waitlist_order_by_joined_at() {
  console.log('\n[测试6] 候补队列按加入时间先后递补');
  const coach = await createCoach();
  const course = await createGroupCourse(2, 1);
  const future = dayjs().add(2, 'day');
  const schedule = await createSchedule(coach, course, future);

  const memberA = await createMember(20);
  const memberB = await createMember(20);
  const memberC = await createMember(20);

  const bookA = await BookingService.bookCourse(memberA.id, schedule.id);

  const waitlistRepo = DS.getRepository(Waitlist);
  const wlB = waitlistRepo.create({
    member_id: memberB.id,
    schedule_id: schedule.id,
    status: WaitlistStatus.QUEUED,
    joined_at: dayjs().subtract(10, 'minute').toDate(),
  });
  await waitlistRepo.save(wlB);
  const wlC = waitlistRepo.create({
    member_id: memberC.id,
    schedule_id: schedule.id,
    status: WaitlistStatus.QUEUED,
    joined_at: dayjs().subtract(2, 'minute').toDate(),
  });
  await waitlistRepo.save(wlC);

  const cancelA = await BookingService.cancelBooking(
    memberA.id,
    bookA.booking_id
  );
  assertEq(
    cancelA.waitlist_auto_filled!.member_id,
    memberB.id,
    '先加的B先被递补'
  );
}

async function main() {
  await ensureDS();
  console.log('=== 开始 Booking + Waitlist 并发与退款测试 ===');
  try {
    await test1_cancel_over_24h_refund_half();
    await test2_cancel_less_24h_no_refund();
    await test3_cancel_triggers_waitlist_autofill();
    await test4_cancel_filled_waitlist_returns_booking_id();
    await test5_cancel_already_cancelled_or_expired_waitlist();
    await test6_waitlist_order_by_joined_at();
    console.log('\n🎉 全部 6 个测试用例通过!');
  } catch (e) {
    console.error('\n❌ 测试失败:', e);
    process.exit(1);
  } finally {
    if (DS) await DS.destroy();
  }
}

main();
