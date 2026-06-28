import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum CoachStatus {
  ACTIVE = 'active',
  ON_LEAVE = 'on_leave',
  INACTIVE = 'inactive',
}

@Entity('coaches')
export class Coach {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, comment: '登录手机号' })
  phone: string;

  @Column({ type: 'varchar', length: 255, comment: '密码哈希' })
  password: string;

  @Column({ type: 'varchar', length: 50, comment: '教练姓名' })
  name: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '头像URL',
  })
  avatar: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '擅长领域',
  })
  specialty: string;

  @Column({
    type: 'text',
    nullable: true,
    comment: '个人简介',
  })
  bio: string;

  @Column({
    type: 'enum',
    enum: CoachStatus,
    default: CoachStatus.ACTIVE,
    comment: '教练状态',
  })
  status: CoachStatus;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updated_at: Date;
}
