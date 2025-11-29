# 大纲生成与存储流程文档

本文档详细说明了 `/outline` 接口的工作原理以及生成的大纲数据是如何被存储的。

## 1. 核心结论

- **`/outline` 接口本身是无状态的**：它只负责生成大纲数据并返回给前端，**不会**在后端自动保存数据。
- **数据存储由 `/history` 接口负责**：前端在收到 `/outline` 的响应后，需要调用 `/history` 接口将大纲数据持久化保存到服务器的文件系统中。
- **存储位置**：所有数据存储在项目根目录下的 `history/` 文件夹中。

## 2. 详细处理流程

### 第一阶段：生成大纲 (POST /outline)

1.  **请求接收**：
    - 前端发送 `POST /outline` 请求，包含 `topic` (主题) 和可选的 `images` (参考图片)。
    - 后端 `src/routes/api.ts` 接收请求。

2.  **大纲生成**：
    - 调用 `OutlineService.generateOutline`。
    - 服务构建 Prompt（提示词），调用配置的 LLM (如 Gemini, OpenAI) 生成文本。
    - 解析生成的文本，将其转换为结构化的 `PageData[]` 数组。

3.  **响应返回**：
    - 后端将生成的 `OutlineResult` (包含大纲文本和页面结构) 以 JSON 格式直接返回给前端。
    - **注意**：此时数据仅在内存中，尚未保存到磁盘。

### 第二阶段：数据存储 (POST /history)

1.  **保存触发**：
    - 前端收到大纲数据后，用户确认或自动触发保存操作。
    - 前端发送 `POST /history` 请求，Payload 包含：
      - `topic`: 主题
      - `outline`: 生成的大纲数据结构
      - `task_id`: 关联的任务ID

2.  **持久化存储**：
    - 后端 `src/routes/api.ts` 调用 `HistoryService.createRecord`。
    - **生成 ID**：为该记录生成一个唯一的 UUID (`recordId`)。
    - **写入文件**：
      - **索引更新**：读取 `history/index.json`，将新记录的元数据（ID, 标题, 时间等）添加到列表头部，并写回文件。
      - **详情存储**：将完整的大纲数据（包含所有页面内容）写入单独的 JSON 文件：`history/{recordId}.json`。

## 3. 存储结构说明

数据存储在项目根目录的 `history/` 目录下，结构如下：

```text
history/
├── index.json              # 索引文件，存储所有记录的摘要列表
├── {recordId}.json         # 详情文件，存储单个记录的完整大纲数据
├── {taskId}/               # 任务目录，存储该任务生成的图片文件
│   ├── 1.png
│   ├── 2.png
│   └── ...
└── ...
```

### 文件内容示例

**1. `history/index.json` (索引)**

```json
{
  "records": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "示例主题",
      "created_at": "2023-11-29T10:00:00.000Z",
      "status": "draft",
      "page_count": 5
      ...
    }
  ]
}
```

**2. `history/{recordId}.json` (详情)**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "示例主题",
  "outline": {
    "outline": "原始大纲文本...",
    "pages": [
      { "index": 0, "type": "cover", "content": "..." },
      { "index": 1, "type": "content", "content": "..." }
    ]
  },
  "images": { ... },
  ...
}
```

## 4. 总结

如果您发现生成的大纲没有保存，请检查：

1.  前端在 `/outline` 请求成功后，是否正确发起了 `/history` 请求。
2.  后端是否有写入 `history/` 目录的权限。
