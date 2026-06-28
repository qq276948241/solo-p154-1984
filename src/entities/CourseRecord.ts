import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Member } from './Member';
import { Booking } from './Booking';

export enum RecordType {
  DEDUCT = 'deduct',
  REFUND = 'refund',
  RECHARGE = 'recharge',
  ADJUST = 'adjust',
}

@Entity('course_records')
@Index(['member_id'])
export class CourseRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', comment: '会员ID' })
  member_id: number;

  @ManyToOne(() => Member)
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'bigint', nullable: true, comment: '关联预约ID' })
  booking_id: number;

  @ManyToOne(() => Booking, { nullable: true })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({
    type: 'enum',
    enum: RecordType,
    comment: '记录类型：扣除/退回/充值/调整',
  })
  type: RecordType;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 1,
    comment: '变动课时数（正数增加，负数减少）',
  })
  hours_change: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 1,
    comment: '变动后剩余课时',
  })
  remaining_after: number;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '备注说明',
  })
  remark: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  created_at: Date;
}
