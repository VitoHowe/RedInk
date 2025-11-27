/**
 * 日志工具模块
 * 使用 winston 提供结构化日志记录
 */
import winston from 'winston';
import path from 'path';

// 日志级别
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// 自定义日志格式
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n  ${JSON.stringify(meta, null, 2)}` : '';
    return `\n${timestamp} | ${level.toUpperCase().padEnd(8)} | ${message}${metaStr}`;
  })
);

// 创建 logger 实例
export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: customFormat,
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        customFormat
      )
    })
  ]
});

// 如果是生产环境,也输出到文件
if (process.env.NODE_ENV === 'production') {
  const logsDir = path.join(process.cwd(), 'logs');
  
  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }));

  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }));
}

// 设置各模块的日志级别
logger.debug('日志系统初始化完成');

export default logger;