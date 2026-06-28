import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum MemberStatus {
  ACTIVE = 'active',
  FROZEN = 'frozen',
  EXPIRED = 'expired',
}

@Entity('members')
export class Member {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, comment: '手机号' })
  phone: string;

  @Column({ type: 'varchar', length: 255, comment: '密码哈希' })
  password: string;

  @Column({ type: 'varchar', length: 50, comment: '昵称' })
  nickname: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '头像URL',
  })
  avatar: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 1,
    default: 0,
    comment: '剩余课时',
  })
  remaining_hours: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 1,
    default: 0,
    comment: '累计消耗课时',
  })
  used_hours: number;

  @Column({
    type: 'enum',
    enum: MemberStatus,
    default: MemberStatus.ACTIVE,
    comment: '会员状态',
  })
  status: MemberStatus;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updated_at: Date;
}
