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

export enum WaitlistStatus {
  QUEUED = 'queued',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

@Entity('waitlists')
@Index(['schedule_id', 'member_id'])
export class Waitlist {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', comment: '排课ID' })
  schedule_id: number;

  @ManyToOne(() => Schedule)
  @JoinColumn({ name: 'schedule_id' })
  schedule: Schedule;

  @Column({ type: 'bigint', comment: '会员ID' })
  member_id: number;

  @ManyToOne(() => Member)
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({
    type: 'enum',
    enum: WaitlistStatus,
    default: WaitlistStatus.QUEUED,
    comment: '候补状态：排队中/已顶上来/主动取消/排课结束',
  })
  status: WaitlistStatus;

  @Column({
    type: 'int',
    nullable: true,
    comment: '候补成功后对应的预约ID',
  })
  booking_id: number;

  @Column({
    type: 'datetime',
    nullable: true,
    comment: '候补成功的时间（顶上来的时间）',
  })
  filled_at: Date;

  @Column({
    type: 'datetime',
    nullable: true,
    comment: '取消/失效时间',
  })
  cancelled_at: Date;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '取消原因（仅主动取消时）',
  })
  cancel_reason: string;

  @CreateDateColumn({ type: 'timestamp', comment: '加入候补时间' })
  joined_at: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updated_at: Date;
}
