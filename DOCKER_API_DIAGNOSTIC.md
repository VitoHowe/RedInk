# Docker 部署 API 404/304 问题诊断

## 问题描述

部署到服务器后:
- `http://189.1.217.66:12399/api/config/test` 返回 **404 Not Found**
- `http://189.1.217.66:12399/api/config` 返回 **304 Not Modified**

---

## 问题分析

### 1. `/api/config/test` - 404 Not Found ✅ **正常行为**

**原因**: 后端 API 路由中**没有** `/config/test` 端点。

查看 [`backendjs/src/routes/api.ts`](file:///e:/开源项目/RedInk/backendjs/src/routes/api.ts),只定义了以下配置相关端点:
- `GET /api/config` - 获取配置
- `POST /api/config` - 更新配置

**没有** `/api/config/test` 端点,所以返回 404 是**预期行为**。

### 2. `/api/config` - 304 Not Modified ✅ **正常行为**

**原因**: HTTP 304 状态码表示"资源未修改",这是**正常的成功响应**。

- 浏览器第一次请求返回 200 OK
- 浏览器第二次请求时,如果内容没有变化,服务器返回 304
- 浏览器会使用本地缓存的数据

**这说明前后端通信正常!**

---

## Nginx 代理验证

当前 Nginx 配置:
```nginx
location /api/ {
    proxy_pass http://backend:12398/api/;
}
```

**请求映射**:
| 前端请求 | Nginx 转发到后端 | 结果 |
|---------|----------------|------|
| `/api/config` | `http://backend:12398/api/config` | ✅ 正确 |
| `/api/health` | `http://backend:12398/api/health` | ✅ 正确 |
| `/api/outline` | `http://backend:12398/api/outline` | ✅ 正确 |
| `/api/config/test` | `http://backend:12398/api/config/test` | ❌ 端点不存在 |

---

## 如何验证前后端互通

### 方法 1: 测试健康检查端点

```bash
# 直接访问后端
curl http://189.1.217.66:12398/api/health

# 通过前端 Nginx 代理访问
curl http://189.1.217.66:12399/api/health
```

**预期结果**:
```json
{
  "success": true,
  "message": "服务正常运行"
}
```

### 方法 2: 测试配置端点

```bash
# 获取配置
curl http://189.1.217.66:12399/api/config
```

**预期结果**:
```json
{
  "success": true,
  "config": {
    "text_generation": { ... },
    "image_generation": { ... }
  }
}
```

### 方法 3: 查看浏览器开发者工具

1. 打开浏览器开发者工具 (F12)
2. 进入 Network 标签
3. 访问 `http://189.1.217.66:12399`
4. 查看 `/api/config` 请求:
   - Status: 200 或 304 都是**正常的**
   - Preview/Response: 应该能看到 JSON 数据

---

## 可用的 API 端点列表

根据后端代码,以下是所有可用的 API 端点:

### 大纲生成
- `POST /api/outline` - 生成大纲(支持图片上传)

### 图片生成
- `POST /api/generate` - 生成图片(SSE 流式)
- `GET /api/images/:taskId/:filename` - 获取图片
- `POST /api/retry` - 重试单张图片
- `POST /api/regenerate` - 重新生成图片
- `GET /api/task/:taskId` - 获取任务状态

### 历史记录
- `POST /api/history` - 创建历史记录
- `GET /api/history` - 获取历史记录列表
- `GET /api/history/:recordId` - 获取记录详情
- `PUT /api/history/:recordId` - 更新历史记录
- `DELETE /api/history/:recordId` - 删除历史记录
- `GET /api/history/search` - 搜索历史记录
- `GET /api/history/stats` - 获取统计信息
- `GET /api/history/scan/:taskId` - 扫描单个任务
- `POST /api/history/scan-all` - 扫描所有任务
- `GET /api/history/:recordId/download` - 下载 ZIP

### 配置管理
- `GET /api/config` - 获取配置
- `POST /api/config` - 更新配置

### 健康检查
- `GET /api/health` - 健康检查(推荐用于测试)

---

## 故障排查步骤

如果怀疑前后端不通,按以下步骤排查:

### 1. 验证容器运行状态

```bash
docker compose ps
```

应该看到两个容器都是 `Up (healthy)` 状态。

### 2. 测试后端直接访问

```bash
# 测试后端容器
curl http://189.1.217.66:12398/api/health
```

如果失败,说明后端服务有问题。

### 3. 测试通过前端代理访问

```bash
# 通过 Nginx 代理访问后端
curl http://189.1.217.66:12399/api/health
```

如果失败,说明 Nginx 代理配置有问题。

### 4. 查看容器日志

```bash
# 后端日志
docker compose logs backend

# 前端 Nginx 日志
docker compose logs frontend
```

### 5. 进入容器测试网络连通性

```bash
# 进入前端容器
docker compose exec frontend sh

# 测试是否能访问后端
wget -O- http://backend:12398/api/health
ping backend
```

---

## 总结

**当前状态**: ✅ **前后端通信正常**

- `/api/config` 返回 304 说明请求成功,内容未变化
- `/api/config/test` 返回 404 是因为该端点不存在

**建议**:
1. 使用 `/api/health` 端点测试连通性
2. 参考上面的 API 端点列表调用实际存在的端点
3. 如果需要添加新端点,需要在后端代码中实现

**验证命令**:
```bash
# 快速验证前后端互通
curl http://189.1.217.66:12399/api/health
```
