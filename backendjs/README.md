# RedInk Backend (Node.js Version)

红墨 AI图文生成器后端服务 - Node.js/TypeScript 实现版本

## 项目概述

这是 RedInk 项目的 Node.js 后端实现,完全同步 Python 版本的所有功能,包括:

- 大纲生成 (基于文本/图片输入)
- 图片批量生成 (支持多种 AI 服务商)
- 历史记录管理
- 多服务商配置管理
- SSE 流式返回

## 技术栈

- **运行环境**: Node.js >= 18.0.0
- **开发语言**: TypeScript 5.6+
- **Web 框架**: Express 4.x
- **AI SDK**:
  - `@google/generative-ai` - Google Gemini/Imagen API
  - `axios` - HTTP 客户端
- **图片处理**: `sharp` - 高性能图片压缩
- **日志**: `winston` - 结构化日志
- **配置**: `js-yaml` - YAML 配置文件解析

## 项目结构

```
backendjs/
├── src/
│   ├── config/              # 配置管理
│   │   └── index.ts         # 配置加载和验证
│   ├── generators/          # 图片生成器
│   │   ├── base.ts          # 生成器基类
│   │   ├── factory.ts       # 生成器工厂
│   │   ├── googleGenai.ts   # Google GenAI 生成器
│   │   ├── openaiCompatible.ts  # OpenAI 兼容生成器
│   │   └── imageApi.ts      # Image API 生成器
│   ├── services/            # 业务服务
│   │   ├── outline.ts       # 大纲生成服务
│   │   ├── image.ts         # 图片生成服务
│   │   └── history.ts       # 历史记录服务
│   ├── routes/              # API 路由
│   │   └── api.ts           # 所有 API 端点
│   ├── utils/               # 工具类
│   │   ├── logger.ts        # 日志工具
│   │   ├── imageCompressor.ts  # 图片压缩
│   │   ├── textClient.ts    # 文本生成客户端
│   │   └── genaiClient.ts   # Google GenAI 客户端
│   └── app.ts               # 应用入口
├── prompts/                 # 提示词模板
│   ├── outline_prompt.txt
│   ├── image_prompt.txt
│   └── image_prompt_short.txt
├── package.json
├── tsconfig.json
└── .env.example

```

## 快速开始

### 1. 安装依赖

```bash
cd backendjs
npm install
```

### 2. 配置环境变量

复制 `.env.example` 到 `.env` 并配置:

```bash
cp .env.example .env
```

```env
PORT=12398
HOST=0.0.0.0
NODE_ENV=development
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
LOG_LEVEL=debug
```

### 3. 配置服务商

在项目根目录创建配置文件:

**text_providers.yaml** (文本生成服务商):
```yaml
active_provider: google_gemini
providers:
  google_gemini:
    type: google_gemini
    api_key: YOUR_GOOGLE_API_KEY
    model: gemini-2.0-flash-exp
    temperature: 1.0
    max_output_tokens: 8000
```

**image_providers.yaml** (图片生成服务商):
```yaml
active_provider: google_genai
providers:
  google_genai:
    type: google_genai
    api_key: YOUR_GOOGLE_API_KEY
    model: imagen-3.0-generate-002
    temperature: 1.0
    default_aspect_ratio: "3:4"
    high_concurrency: true
```

### 4. 启动服务

开发模式(自动重启):
```bash
npm run dev
```

生产模式:
```bash
npm run build
npm start
```

## API 端点

详细的 API 文档请参考 [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)

### 核心端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/outline` | 生成大纲 |
| POST | `/api/generate` | 批量生成图片 (SSE) |
| POST | `/api/retry` | 重试单张图片 |
| POST | `/api/retry-failed` | 批量重试失败图片 |
| POST | `/api/regenerate` | 重新生成图片 |
| GET  | `/api/images/:task_id/:filename` | 获取图片 |
| GET  | `/api/task/:task_id` | 获取任务状态 |
| GET  | `/api/health` | 健康检查 |

### 历史记录端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/history` | 创建历史记录 |
| GET  | `/api/history` | 获取历史记录列表 |
| GET  | `/api/history/:id` | 获取单条记录详情 |
| PUT  | `/api/history/:id` | 更新历史记录 |
| DELETE | `/api/history/:id` | 删除历史记录 |
| GET  | `/api/history/search` | 搜索历史记录 |
| GET  | `/api/history/stats` | 获取统计信息 |

### 配置管理端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/config` | 获取当前配置 |
| POST | `/api/config` | 更新配置 |
| POST | `/api/config/test` | 测试服务商连接 |

## 支持的 AI 服务商

### 文本生成

1. **Google Gemini**
   - 类型: `google_gemini`
   - 推荐模型: `gemini-2.0-flash-exp`

2. **OpenAI 兼容**
   - 类型: `openai_compatible`
   - 支持任何 OpenAI 格式的 API

### 图片生成

1. **Google GenAI (Imagen)**
   - 类型: `google_genai`
   - 推荐模型: `imagen-3.0-generate-002`

2. **OpenAI DALL-E**
   - 类型: `openai_compatible`
   - 模型: `dall-e-3`

3. **Image API**
   - 类型: `image_api`
   - 通用图片生成 API 接口

## 开发指南

### 添加新的生成器

1. 在 `src/generators/` 创建新的生成器类,继承 `ImageGeneratorBase`
2. 实现 `generateImage()` 和 `validateConfig()` 方法
3. 在 `factory.ts` 中注册新生成器

### 日志系统

使用 Winston 进行日志记录:

```typescript
import { logger } from './utils/logger';

logger.info('信息日志');
logger.warn('警告日志');
logger.error('错误日志');
logger.debug('调试日志');
```

### 错误处理

所有错误应该包含:
- 清晰的错误描述
- 可能的原因分析
- 具体的解决方案

```typescript
throw new Error(
  '❌ 操作失败\n\n' +
  '【可能原因】\n' +
  '1. 原因一\n' +
  '2. 原因二\n\n' +
  '【解决方案】\n' +
  '1. 解决方案一\n' +
  '2. 解决方案二'
);
```

## 功能特性

### 1. 图片压缩

自动压缩上传的参考图片到 200KB 以内,减少 API 调用开销:

```typescript
import { compressImage } from './utils/imageCompressor';

const compressed = await compressImage(imageData, 200); // 200KB
```

### 2. 并发控制

支持高并发模式,最多同时生成 15 张图片:

```yaml
providers:
  your_provider:
    high_concurrency: true  # 启用高并发
```

### 3. 自动重试

内置智能重试机制:
- 遇到速率限制(429)自动重试
- 网络错误自动重试
- 最多重试 3-5 次

### 4. SSE 流式返回

图片生成使用 SSE 实时推送进度:

```typescript
// 前端接收示例
const eventSource = new EventSource('/api/generate');

eventSource.addEventListener('progress', (e) => {
  const data = JSON.parse(e.data);
  console.log(`生成进度: ${data.current}/${data.total}`);
});

eventSource.addEventListener('complete', (e) => {
  const data = JSON.parse(e.data);
  console.log(`图片完成: ${data.image_url}`);
});
```

## 与 Python 版本的对比

| 功能 | Python 版本 | Node.js 版本 | 说明 |
|------|------------|-------------|------|
| 大纲生成 | ✅ | ✅ | 完全同步 |
| 图片生成 | ✅ | ✅ | 完全同步 |
| 历史记录 | ✅ | ✅ | 完全同步 |
| 多服务商 | ✅ | ✅ | 完全同步 |
| SSE 流式 | ✅ | ✅ | 完全同步 |
| 并发生成 | ✅ | ✅ | 完全同步 |
| 图片压缩 | ✅ | ✅ | 使用 sharp 实现 |
| 配置管理 | ✅ | ✅ | 完全同步 |
| 错误处理 | ✅ | ✅ | 完全同步 |

## 性能优化

1. **图片压缩**: 所有参考图片自动压缩到 200KB
2. **并发控制**: 支持最多 15 并发图片生成
3. **内存管理**: 及时释放任务状态,避免内存泄漏
4. **缓存配置**: 配置文件加载后缓存,避免重复读取

## 故障排查

### 常见问题

1. **端口被占用**
   ```bash
   # 修改 .env 文件中的 PORT
   PORT=12399
   ```

2. **API Key 无效**
   - 检查 `text_providers.yaml` 和 `image_providers.yaml`
   - 确保 API Key 正确且有效

3. **模块未找到**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

4. **TypeScript 编译错误**
   ```bash
   npm run build
   ```

## 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

MIT License

## 联系方式

如有问题或建议,欢迎提交 Issue。