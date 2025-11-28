/**
 * 应用入口
 * Express 应用主文件
 */
// 必须在最开始加载环境变量
import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { logger } from './utils/logger';
import apiRouter from './routes/api';
import { Application } from 'express';

const app: Application = express();
const PORT = process.env.PORT || 8080;

// ==================== 中间件配置 ====================

// 1. CORS配置 - 允许前端跨域访问
app.use(cors({
  origin: '*', // 开发环境允许所有来源,生产环境应该限制具体域名
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// 2. JSON解析 - 限制请求体大小为50MB(支持大图片base64)
app.use(express.json({ limit: '50mb' }));

// 3. URL编码解析
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 4. 请求日志中间件
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  // 记录请求
  logger.debug(`➡️  ${req.method} ${req.path}`);
  
  // 监听响应完成
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusColor = res.statusCode >= 400 ? '❌' : '✅';
    logger.debug(`${statusColor} ${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
  });
  
  next();
});

// ==================== 静态文件服务 ====================

// 提供 history 目录的静态文件访问(图片等)
// 注意：使用 /static/history 避免与 /api/history API路由冲突
const historyDir = path.join(process.cwd(), 'history');
app.use('/static/history', express.static(historyDir, {
  maxAge: '1h', // 缓存1小时
  etag: true
}));

// ==================== API路由 ====================

// 注册所有API路由到 /api 前缀下
app.use('/api', apiRouter);

// ==================== 根路径响应 ====================

app.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: '红墨 - 小红书文案图片生成器 (Node.js版)',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      outline: '/api/outline',
      generate: '/api/generate',
      history: '/api/history',
      config: '/api/config',
      docs: 'https://github.com/your-repo/RedInk'
    }
  });
});

// ==================== 404 处理 ====================

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `路由不存在: ${req.method} ${req.path}`,
    message: '请检查API文档以获取正确的端点信息'
  });
});

// ==================== 全局错误处理 ====================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('未捕获的错误:');
  logger.error(`  路径: ${req.method} ${req.path}`);
  logger.error(`  错误: ${err.message}`);
  logger.error(`  堆栈: ${err.stack}`);
  
  // 返回错误响应
  res.status(500).json({
    success: false,
    error: '服务器内部错误',
    message: err.message,
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ==================== 启动服务器 ====================

const server = app.listen(PORT, () => {
  logger.info('='.repeat(60));
  logger.info('🚀 红墨 (RedInk) - 小红书文案图片生成器');
  logger.info('='.repeat(60));
  logger.info(`📡 服务器运行在: http://localhost:${PORT}`);
  logger.info(`🌍 环境: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`📁 工作目录: ${process.cwd()}`);
  logger.info(`📝 API文档: ${process.cwd()}/API_DOCUMENTATION.md`);
  logger.info('='.repeat(60));
  logger.info('可用端点:');
  logger.info(`  - GET  /api/health         健康检查`);
  logger.info(`  - POST /api/outline        生成大纲`);
  logger.info(`  - POST /api/generate       生成图片(SSE)`);
  logger.info(`  - GET  /api/history        获取历史列表`);
  logger.info(`  - GET  /api/config         获取配置`);
  logger.info(`  - POST /api/config         更新配置`);
  logger.info('='.repeat(60));
  logger.info('✨ 服务已就绪，等待请求...');
  logger.info('');
});

// ==================== 优雅关闭 ====================

process.on('SIGTERM', () => {
  logger.info('收到 SIGTERM 信号，准备关闭服务器...');
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('\n收到 SIGINT 信号，准备关闭服务器...');
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
});

// ==================== 未捕获异常处理 ====================

process.on('uncaughtException', (err: Error) => {
  logger.error('未捕获的异常:');
  logger.error(err);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('未处理的Promise拒绝:');
  logger.error(reason);
  process.exit(1);
});

export default app;