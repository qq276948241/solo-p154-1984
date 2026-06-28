import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { Member } from './entities/Member';
import { Coach } from './entities/Coach';
import { Course } from './entities/Course';
import { Schedule } from './entities/Schedule';
import { Booking } from './entities/Booking';
import { CourseRecord } from './entities/CourseRecord';
import { CoachLeave } from './entities/CoachLeave';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  synchronize: true,
  logging: false,
  entities: [Member, Coach, Course, Schedule, Booking, CourseRecord, CoachLeave],
  migrations: [],
  subscribers: [],
  timezone: '+08:00',
  dateStrings: true,
});
