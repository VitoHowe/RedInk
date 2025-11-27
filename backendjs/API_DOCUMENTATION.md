# RedInk Backend API 文档

完整的 API 接口文档，包含所有端点的详细说明、请求参数和响应格式。

## 基础信息

- **Base URL**: `http://localhost:12398`
- **协议**: HTTP/HTTPS
- **数据格式**: JSON
- **字符编码**: UTF-8

## 认证

当前版本不需要认证，但在生产环境中建议添加 API Key 或 OAuth2 认证。

---

## 核心功能 API

### 1. 生成大纲

根据用户输入的主题和可选的参考图片生成内容大纲。

**端点**: `POST /api/outline`

**Content-Type**: 
- `application/json` (纯文本输入)
- `multipart/form-data` (包含图片)

**请求参数**:

JSON 格式:
```json
{
  "topic": "咖啡文化探索",
  "images": ["base64_encoded_image_1", "base64_encoded_image_2"]
}
```

FormData 格式:
```
topic: "咖啡文化探索"
images: [File1, File2, ...]
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| topic | string | 是 | 主题内容 |
| images | array | 否 | 参考图片列表 (base64 或文件) |

**响应示例**:
```json
{
  "success": true,
  "outline": "完整的大纲文本...",
  "pages": [
    {
      "index": 0,
      "type": "cover",
      "content": "[封面]\n标题: 咖啡文化探索\n..."
    },
    {
      "index": 1,
      "type": "content",
      "content": "[内容]\n咖啡的历史起源\n..."
    }
  ],
  "has_images": false
}
```

**错误响应**:
```json
{
  "success": false,
  "error": "参数错误：topic 不能为空。\n请提供要生成图文的主题内容。"
}
```

---

### 2. 批量生成图片

根据大纲批量生成图片，使用 SSE (Server-Sent Events) 流式返回进度。

**端点**: `POST /api/generate`

**Content-Type**: `application/json`

**请求参数**:
```json
{
  "pages": [
    {
      "index": 0,
      "type": "cover",
      "content": "封面内容..."
    }
  ],
  "task_id": "task_abc123",
  "full_outline": "完整大纲文本",
  "user_topic": "用户原始输入",
  "user_images": ["base64_image_1", "base64_image_2"]
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pages | array | 是 | 页面列表 |
| task_id | string | 否 | 任务 ID (自动生成) |
| full_outline | string | 否 | 完整大纲 (用于保持风格) |
| user_topic | string | 否 | 用户原始输入 |
| user_images | array | 否 | 用户上传的参考图片 |

**SSE 事件流**:

1. **progress** - 生成进度
```json
{
  "event": "progress",
  "data": {
    "index": 0,
    "status": "generating",
    "message": "正在生成封面...",
    "current": 1,
    "total": 5,
    "phase": "cover"
  }
}
```

2. **complete** - 单张图片完成
```json
{
  "event": "complete",
  "data": {
    "index": 0,
    "status": "done",
    "image_url": "/api/images/task_abc123/0.png",
    "phase": "cover"
  }
}
```

3. **error** - 生成失败
```json
{
  "event": "error",
  "data": {
    "index": 1,
    "status": "error",
    "message": "API 配额已用尽",
    "retryable": true,
    "phase": "content"
  }
}
```

4. **finish** - 全部完成
```json
{
  "event": "finish",
  "data": {
    "success": true,
    "task_id": "task_abc123",
    "images": ["0.png", "1.png", "2.png"],
    "total": 5,
    "completed": 3,
    "failed": 2,
    "failed_indices": [3, 4]
  }
}
```

**前端接收示例**:
```javascript
const eventSource = new EventSource('/api/generate', {
  method: 'POST',
  body: JSON.stringify(payload)
});

eventSource.addEventListener('progress', (e) => {
  const data = JSON.parse(e.data);
  console.log(`进度: ${data.current}/${data.total}`);
});

eventSource.addEventListener('complete', (e) => {
  const data = JSON.parse(e.data);
  console.log(`完成: ${data.image_url}`);
});

eventSource.addEventListener('finish', (e) => {
  const data = JSON.parse(e.data);
  eventSource.close();
});
```

---

### 3. 获取图片

获取生成的图片文件，支持原图和缩略图。

**端点**: `GET /api/images/:task_id/:filename`

**Query 参数**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| thumbnail | boolean | true | 是否返回缩略图 |

**示例**:
- 原图: `/api/images/task_abc123/0.png?thumbnail=false`
- 缩略图: `/api/images/task_abc123/0.png?thumbnail=true`

**响应**: 图片二进制数据 (Content-Type: image/png)

---

### 4. 重试单张图片

重新生成某一张失败的图片。

**端点**: `POST /api/retry`

**请求参数**:
```json
{
  "task_id": "task_abc123",
  "page": {
    "index": 2,
    "type": "content",
    "content": "页面内容..."
  },
  "use_reference": true
}
```

**响应**:
```json
{
  "success": true,
  "index": 2,
  "image_url": "/api/images/task_abc123/2.png"
}
```

---

### 5. 批量重试失败图片

批量重试所有失败的图片 (SSE 流式返回)。

**端点**: `POST /api/retry-failed`

**请求参数**:
```json
{
  "task_id": "task_abc123",
  "pages": [
    {
      "index": 3,
      "type": "content",
      "content": "..."
    },
    {
      "index": 4,
      "type": "summary",
      "content": "..."
    }
  ]
}
```

**SSE 事件**: 与 `/api/generate` 类似

---

### 6. 重新生成图片

重新生成某一张图片 (即使已经成功)。

**端点**: `POST /api/regenerate`

**请求参数**:
```json
{
  "task_id": "task_abc123",
  "page": {
    "index": 1,
    "type": "content",
    "content": "..."
  },
  "use_reference": true,
  "full_outline": "完整大纲",
  "user_topic": "用户原始输入"
}
```

**响应**: 与 `/api/retry` 相同

---

### 7. 获取任务状态

获取当前任务的状态信息。

**端点**: `GET /api/task/:task_id`

**响应**:
```json
{
  "success": true,
  "state": {
    "generated": {
      "0": "0.png",
      "1": "1.png"
    },
    "failed": {
      "2": "API 配额已用尽"
    },
    "has_cover": true
  }
}
```

---

### 8. 健康检查

检查服务是否正常运行。

**端点**: `GET /api/health`

**响应**:
```json
{
  "success": true,
  "message": "服务正常运行"
}
```

---

## 历史记录 API

### 1. 创建历史记录

**端点**: `POST /api/history`

**请求参数**:
```json
{
  "topic": "咖啡文化探索",
  "outline": {
    "outline": "大纲文本",
    "pages": [...]
  },
  "task_id": "task_abc123"
}
```

**响应**:
```json
{
  "success": true,
  "record_id": "uuid-1234-5678"
}
```

---

### 2. 获取历史记录列表

**端点**: `GET /api/history`

**Query 参数**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| page_size | number | 20 | 每页数量 |
| status | string | - | 筛选状态 (draft/generating/completed/partial) |

**响应**:
```json
{
  "success": true,
  "records": [
    {
      "id": "uuid-1234",
      "title": "咖啡文化探索",
      "created_at": "2025-01-15T10:30:00Z",
      "updated_at": "2025-01-15T10:35:00Z",
      "status": "completed",
      "thumbnail": "0.png",
      "page_count": 5,
      "task_id": "task_abc123"
    }
  ],
  "total": 100,
  "page": 1,
  "page_size": 20,
  "total_pages": 5
}
```

---

### 3. 获取历史记录详情

**端点**: `GET /api/history/:record_id`

**响应**:
```json
{
  "success": true,
  "record": {
    "id": "uuid-1234",
    "title": "咖啡文化探索",
    "created_at": "2025-01-15T10:30:00Z",
    "updated_at": "2025-01-15T10:35:00Z",
    "outline": {
      "outline": "...",
      "pages": [...]
    },
    "images": {
      "task_id": "task_abc123",
      "generated": ["0.png", "1.png", "2.png"]
    },
    "status": "completed",
    "thumbnail": "0.png"
  }
}
```

---

### 4. 更新历史记录

**端点**: `PUT /api/history/:record_id`

**请求参数**:
```json
{
  "outline": {...},
  "images": {...},
  "status": "completed",
  "thumbnail": "0.png"
}
```

**响应**:
```json
{
  "success": true
}
```

---

### 5. 删除历史记录

**端点**: `DELETE /api/history/:record_id`

**响应**:
```json
{
  "success": true
}
```

---

### 6. 搜索历史记录

**端点**: `GET /api/history/search`

**Query 参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | string | 是 | 搜索关键词 |

**响应**:
```json
{
  "success": true,
  "records": [...]
}
```

---

### 7. 获取统计信息

**端点**: `GET /api/history/stats`

**响应**:
```json
{
  "success": true,
  "total": 150,
  "by_status": {
    "draft": 10,
    "generating": 5,
    "completed": 120,
    "partial": 15
  }
}
```

---

### 8. 扫描任务

扫描单个任务并同步图片列表。

**端点**: `GET /api/history/scan/:task_id`

**响应**:
```json
{
  "success": true,
  "record_id": "uuid-1234",
  "task_id": "task_abc123",
  "images_count": 5,
  "images": ["0.png", "1.png", "2.png", "3.png", "4.png"],
  "status": "completed"
}
```

---

### 9. 扫描所有任务

**端点**: `POST /api/history/scan-all`

**响应**:
```json
{
  "success": true,
  "total_tasks": 50,
  "synced": 45,
  "failed": 2,
  "orphan_tasks": ["task_xyz"],
  "results": [...]
}
```

---

### 10. 下载图片压缩包

下载某个历史记录的所有图片为 ZIP 文件。

**端点**: `GET /api/history/:record_id/download`

**响应**: ZIP 文件 (Content-Type: application/zip)

---

## 配置管理 API

### 1. 获取当前配置

**端点**: `GET /api/config`

**响应**:
```json
{
  "success": true,
  "config": {
    "text_generation": {
      "active_provider": "google_gemini",
      "providers": {
        "google_gemini": {
          "type": "google_gemini",
          "model": "gemini-2.0-flash-exp",
          "api_key_masked": "AIza****xyz",
          "api_key": ""
        }
      }
    },
    "image_generation": {
      "active_provider": "google_genai",
      "providers": {
        "google_genai": {
          "type": "google_genai",
          "model": "imagen-3.0-generate-002",
          "api_key_masked": "AIza****abc",
          "api_key": ""
        }
      }
    }
  }
}
```

---

### 2. 更新配置

**端点**: `POST /api/config`

**请求参数**:
```json
{
  "text_generation": {
    "active_provider": "google_gemini",
    "providers": {
      "google_gemini": {
        "type": "google_gemini",
        "api_key": "new_api_key",
        "model": "gemini-2.0-flash-exp"
      }
    }
  },
  "image_generation": {
    "active_provider": "google_genai",
    "providers": {
      "google_genai": {
        "type": "google_genai",
        "api_key": "new_api_key",
        "model": "imagen-3.0-generate-002"
      }
    }
  }
}
```

**响应**:
```json
{
  "success": true,
  "message": "配置已保存"
}
```

---

### 3. 测试服务商连接

**端点**: `POST /api/config/test`

**请求参数**:
```json
{
  "type": "google_gemini",
  "provider_name": "google_gemini",
  "api_key": "test_key",
  "base_url": "https://api.example.com",
  "model": "gemini-2.0-flash-exp"
}
```

**响应**:
```json
{
  "success": true,
  "message": "连接成功！响应: 你好，红墨"
}
```

---

## 错误码说明

| HTTP 状态码 | 说明 |
|------------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

所有错误响应格式:
```json
{
  "success": false,
  "error": "详细的错误信息\n包含可能原因和解决方案"
}
```

---

## 数据模型

### Page 对象
```typescript
{
  index: number;        // 页面索引
  type: string;         // 页面类型: cover | content | summary
  content: string;      // 页面内容
}
```

### HistoryRecord 对象
```typescript
{
  id: string;
  title: string;
  created_at: string;   // ISO 8601 格式
  updated_at: string;
  outline: {
    outline: string;
    pages: Page[];
  };
  images: {
    task_id: string;
    generated: string[];
  };
  status: string;       // draft | generating | completed | partial
  thumbnail: string;
}
```

---

## 速率限制

当前版本无速率限制，但建议:
- 单个任务不超过 20 页
- 并发请求不超过 5 个
- 图片生成间隔至少 1 秒

---

## 版本信息

- **API 版本**: v1.0.0
- **最后更新**: 2025-01-15

---

## 联系支持

如有问题或建议，请提交 Issue。