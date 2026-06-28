import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CourseType {
  GROUP = 'group',
  PRIVATE = 'private',
}

@Entity('courses')
export class Course {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 100, comment: '课程名称' })
  name: string;

  @Column({
    type: 'enum',
    enum: CourseType,
    comment: '课程类型：团课/私教',
  })
  type: CourseType;

  @Column({
    type: 'int',
    comment: '课程时长（分钟）',
    default: 60,
  })
  duration_minutes: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 1,
    comment: '消耗课时数',
    default: 1,
  })
  cost_hours: number;

  @Column({
    type: 'int',
    nullable: true,
    comment: '团课最大人数（私教为null）',
  })
  max_capacity: number;

  @Column({
    type: 'text',
    nullable: true,
    comment: '课程描述',
  })
  description: string;

  @Column({
    type: 'tinyint',
    default: 1,
    comment: '是否启用',
  })
  is_active: number;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updated_at: Date;
}
