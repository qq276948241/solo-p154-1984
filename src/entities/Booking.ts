import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Member } from './Member';
import { Schedule } from './Schedule';

export enum BookingStatus {
  BOOKED = 'booked',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
  NO_SHOW = 'no_show',
}

@Entity('bookings')
@Index(['member_id', 'schedule_id'], { unique: true })
export class Booking {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', comment: '会员ID' })
  member_id: number;

  @ManyToOne(() => Member)
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'bigint', comment: '排课ID' })
  schedule_id: number;

  @ManyToOne(() => Schedule)
  @JoinColumn({ name: 'schedule_id' })
  schedule: Schedule;

  @Column({
    type: 'enum',
    enum: BookingStatus,
    default: BookingStatus.BOOKED,
    comment: '预约状态',
  })
  status: BookingStatus;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 1,
    comment: '预约时扣除的课时',
  })
  deducted_hours: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 1,
    default: 0,
    comment: '取消时退回的课时',
  })
  refunded_hours: number;

  @Column({
    type: 'datetime',
    nullable: true,
    comment: '取消时间',
  })
  cancelled_at: Date;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '取消原因',
  })
  cancel_reason: string;

  @Column({
    type: 'tinyint',
    default: 0,
    comment: '是否已签到',
  })
  is_checked_in: number;

  @Column({
    type: 'datetime',
    nullable: true,
    comment: '签到时间',
  })
  checked_in_at: Date;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updated_at: Date;
}
