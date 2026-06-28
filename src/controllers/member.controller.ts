import { Request, Response } from 'express';
import { AppDataSource } from '../data-source';
import { Member, MemberStatus } from '../entities/Member';
import { CourseRecord, RecordType } from '../entities/CourseRecord';
import { ErrorCode } from '../constants/error-code';
import { throwError } from '../utils/app-error';
import { hashPassword, comparePassword } from '../utils/password';
import { isValidPhone, omit } from '../utils/validate';
import { generateToken } from '../middleware/auth';
import { Between } from 'typeorm';
import dayjs = require('dayjs');

const memberRepo = () => AppDataSource.getRepository(Member);
const recordRepo = () => AppDataSource.getRepository(CourseRecord);

export async function register(req: Request, res: Response) {
  const { phone, password, nickname } = req.body;

  if (!isValidPhone(phone)) {
    return res.jsonFail(ErrorCode.PARAM_ERROR, '手机号格式不正确');
  }
  if (!password || password.length < 6) {
    return res.jsonFail(ErrorCode.PARAM_ERROR, '密码至少6位');
  }
  if (!nickname) {
    return res.jsonFail(ErrorCode.PARAM_ERROR, '请填写昵称');
  }

  const existing = await memberRepo().findOne({ where: { phone } });
  if (existing) {
    return res.jsonFail(ErrorCode.MEMBER_ALREADY_EXISTS);
  }

  const member = memberRepo().create({
    phone,
    password: hashPassword(password),
    nickname,
  });
  await memberRepo().save(member);

  const token = generateToken({
    id: member.id,
    role: 'member',
    phone: member.phone,
  });

  return res.jsonSuccess({
    token,
    member: omit(member, ['password']),
  }, '注册成功');
}

export async function login(req: Request, res: Response) {
  const { phone, password } = req.body;

  if (!isValidPhone(phone) || !password) {
    return res.jsonFail(ErrorCode.PARAM_ERROR);
  }

  const member = await memberRepo().findOne({ where: { phone } });
  if (!member) {
    return res.jsonFail(ErrorCode.MEMBER_NOT_FOUND);
  }

  if (!comparePassword(password, member.password)) {
    return res.jsonFail(ErrorCode.MEMBER_PASSWORD_WRONG);
  }

  if (member.status === MemberStatus.FROZEN) {
    return res.jsonFail(ErrorCode.MEMBER_FROZEN);
  }

  const token = generateToken({
    id: member.id,
    role: 'member',
    phone: member.phone,
  });

  return res.jsonSuccess({
    token,
    member: omit(member, ['password']),
  }, '登录成功');
}

export async function getProfile(req: Request, res: Response) {
  const member = await memberRepo().findOne({ where: { id: req.user!.id } });
  if (!member) {
    return res.jsonFail(ErrorCode.MEMBER_NOT_FOUND);
  }
  return res.jsonSuccess(omit(member, ['password']));
}

export async function updateProfile(req: Request, res: Response) {
  const { nickname, avatar } = req.body;
  const member = await memberRepo().findOne({ where: { id: req.user!.id } });
  if (!member) {
    return res.jsonFail(ErrorCode.MEMBER_NOT_FOUND);
  }

  if (nickname !== undefined) member.nickname = nickname;
  if (avatar !== undefined) member.avatar = avatar;

  await memberRepo().save(member);
  return res.jsonSuccess(omit(member, ['password']));
}

export async function getRemainingHours(req: Request, res: Response) {
  const member = await memberRepo().findOne({ where: { id: req.user!.id } });
  if (!member) {
    return res.jsonFail(ErrorCode.MEMBER_NOT_FOUND);
  }
  return res.jsonSuccess({
    remaining_hours: Number(member.remaining_hours),
    used_hours: Number(member.used_hours),
  });
}

export async function getCourseRecords(req: Request, res: Response) {
  const { page = 1, pageSize = 20, type, startDate, endDate } = req.query;

  const memberId = req.user!.id;
  const where: any = { member_id: memberId };

  if (type) {
    where.type = type;
  }
  if (startDate && endDate) {
    where.created_at = Between(
      dayjs(startDate as string).startOf('day').toDate(),
      dayjs(endDate as string).endOf('day').toDate()
    );
  }

  const [records, total] = await recordRepo().findAndCount({
    where,
    order: { created_at: 'DESC' },
    skip: (Number(page) - 1) * Number(pageSize),
    take: Number(pageSize),
  });

  return res.jsonSuccess({
    list: records,
    total,
    page: Number(page),
    pageSize: Number(pageSize),
  });
}
