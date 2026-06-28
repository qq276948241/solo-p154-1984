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
import { Course } from './Course';

export enum ScheduleStatus {
  AVAILABLE = 'available',
  FULL = 'full',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

@Entity('schedules')
@Index(['coach_id', 'start_time', 'end_time'])
export class Schedule {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', comment: '教练ID' })
  coach_id: number;

  @ManyToOne(() => Coach)
  @JoinColumn({ name: 'coach_id' })
  coach: Coach;

  @Column({ type: 'bigint', comment: '课程ID' })
  course_id: number;

  @ManyToOne(() => Course)
  @JoinColumn({ name: 'course_id' })
  course: Course;

  @Column({ type: 'datetime', comment: '开始时间' })
  start_time: Date;

  @Column({ type: 'datetime', comment: '结束时间' })
  end_time: Date;

  @Column({
    type: 'int',
    default: 0,
    comment: '已预约人数',
  })
  booked_count: number;

  @Column({
    type: 'enum',
    enum: ScheduleStatus,
    default: ScheduleStatus.AVAILABLE,
    comment: '排课状态',
  })
  status: ScheduleStatus;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '教室/地点',
  })
  location: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updated_at: Date;
}
