# RedInk Docker 部署指南

## 📦 项目结构

```
RedInk/
├── backendjs/              # 后端服务 (Node.js)
│   ├── Dockerfile          # 后端 Docker 配置
│   └── .dockerignore       # Docker 忽略文件
├── frontend/               # 前端服务 (Vue.js)
│   ├── Dockerfile          # 前端 Docker 配置
│   ├── nginx.conf          # Nginx 配置
│   └── .dockerignore       # Docker 忽略文件
├── docker-compose.yml      # Docker Compose 编排
├── text_providers.yaml     # 文本生成配置
├── image_providers.yaml    # 图片生成配置
├── output/                 # 输出目录
└── history/                # 历史记录
```

## 🚀 快速开始

### 前置要求

- Docker 20.10+
- Docker Compose 2.0+

### 部署步骤

1. **克隆或进入项目目录**
   ```bash
   cd e:\开源项目\RedInk
   ```

2. **配置提供商**
   
   确保 `text_providers.yaml` 和 `image_providers.yaml` 配置正确,包含有效的 API 密钥。

3. **构建并启动服务**
   ```bash
   docker-compose up -d --build
   ```

4. **查看服务状态**
   ```bash
   docker-compose ps
   ```

5. **查看日志**
   ```bash
   # 查看所有服务日志
   docker-compose logs -f
   
   # 查看特定服务日志
   docker-compose logs -f backend
   docker-compose logs -f frontend
   ```

## 🌐 访问地址

- **前端**: http://localhost:12399
- **后端 API**: http://localhost:12398

前端会自动通过 Nginx 代理访问后端 API (`/api` 路径)。

## 🔧 配置说明

### 后端环境变量

可在 `docker-compose.yml` 中的 `backend` 服务下的 `environment` 部分修改:

```yaml
environment:
  - NODE_ENV=production          # 运行环境
  - PORT=12398                   # 后端端口
  - HOST=0.0.0.0                 # 监听地址
  - CORS_ORIGINS=...             # CORS 允许的源
  - OUTPUT_DIR=output            # 输出目录
  - LOG_LEVEL=info               # 日志级别
```

### 卷挂载

以下目录会持久化到宿主机:

- `./output` - 生成的图片输出
- `./history` - 历史记录
- `./text_providers.yaml` - 文本生成配置
- `./image_providers.yaml` - 图片生成配置

## 📝 常用命令

```bash
# 启动服务
docker-compose up -d

# 停止服务
docker-compose down

# 重启服务
docker-compose restart

# 重新构建并启动
docker-compose up -d --build

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 进入容器
docker-compose exec backend sh
docker-compose exec frontend sh

# 清理所有容器和卷
docker-compose down -v
```

## 🔍 故障排查

### 后端无法启动

1. 检查日志: `docker-compose logs backend`
2. 确认配置文件是否存在且有效
3. 检查端口 12398 是否被占用

### 前端无法访问后端

1. 确认后端服务已启动: `docker-compose ps`
2. 检查网络连接: `docker-compose exec frontend ping backend`
3. 查看 Nginx 日志: `docker-compose logs frontend`

### 配置文件修改后不生效

重新构建并启动服务:
```bash
docker-compose down
docker-compose up -d --build
```

## 🏗️ 架构说明

```
┌─────────────────┐
│   浏览器         │
│ localhost:12399 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Frontend       │
│  (Nginx)        │
│  Port: 12399    │
└────────┬────────┘
         │ /api/* 请求
         ▼
┌─────────────────┐
│  Backend        │
│  (Node.js)      │
│  Port: 12398    │
└─────────────────┘
```

- **Frontend**: 使用 Nginx 提供静态文件服务,并代理 `/api` 请求到后端
- **Backend**: Node.js 应用,处理所有 API 请求
- **Network**: 通过 Docker 自定义网络 `redink-network` 实现服务间通信

## 📚 更多信息

- 后端 API 文档: `backendjs/API_DOCUMENTATION.md`
- 后端 README: `backendjs/README.md`

## ⚠️ 注意事项

1. 首次构建可能需要较长时间,请耐心等待
2. 确保 Docker 有足够的磁盘空间
3. 生产环境建议修改默认的日志级别为 `warn` 或 `error`
4. 定期备份 `output` 和 `history` 目录
