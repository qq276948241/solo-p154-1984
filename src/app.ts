import 'reflect-metadata';
import * as dotenv from 'dotenv';
import express = require('express');
import cors = require('cors');
import { Request, Response } from 'express';
import { AppDataSource } from './data-source';
import { responseMiddleware, errorHandler } from './middleware/response';
import memberRoutes from './routes/member.routes';
import courseRoutes from './routes/course.routes';
import coachRoutes from './routes/coach.routes';
import { ErrorCode } from './constants/error-code';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(responseMiddleware);

app.get('/health', (req: Request, res: Response) => {
  res.jsonSuccess({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: AppDataSource.isInitialized ? 'connected' : 'disconnected',
  });
});

app.use('/api/v1/member', memberRoutes);
app.use('/api/v1/course', courseRoutes);
app.use('/api/v1/coach', coachRoutes);

app.use('*', (req: Request, res: Response) => {
  res.jsonFail(ErrorCode.NOT_FOUND, '接口不存在');
});

app.use(errorHandler);

async function bootstrap() {
  try {
    await AppDataSource.initialize();
    console.log('[DB] MySQL 数据库连接成功');

    app.listen(PORT, () => {
      console.log(`[Server] 服务已启动: http://localhost:${PORT}`);
      console.log(`[Health] 健康检查: http://localhost:${PORT}/health`);
      console.log('');
      console.log('接口前缀: /api/v1');
      console.log('  - 会员模块: /api/v1/member/*');
      console.log('  - 课程模块: /api/v1/course/*');
      console.log('  - 教练模块: /api/v1/coach/*');
    });
  } catch (error) {
    console.error('[启动失败]', error);
    process.exit(1);
  }
}

bootstrap();
