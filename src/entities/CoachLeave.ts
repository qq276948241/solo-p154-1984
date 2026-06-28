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
import { Coach } from './Coach';

export enum LeaveStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('coach_leaves')
@Index(['coach_id', 'leave_date'])
export class CoachLeave {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', comment: '教练ID' })
  coach_id: number;

  @ManyToOne(() => Coach)
  @JoinColumn({ name: 'coach_id' })
  coach: Coach;

  @Column({ type: 'date', comment: '请假日期' })
  leave_date: Date;

  @Column({ type: 'datetime', nullable: true, comment: '请假开始时间' })
  start_time: Date;

  @Column({ type: 'datetime', nullable: true, comment: '请假结束时间' })
  end_time: Date;

  @Column({
    type: 'text',
    nullable: true,
    comment: '请假原因',
  })
  reason: string;

  @Column({
    type: 'enum',
    enum: LeaveStatus,
    default: LeaveStatus.APPROVED,
    comment: '审批状态',
  })
  status: LeaveStatus;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updated_at: Date;
}
