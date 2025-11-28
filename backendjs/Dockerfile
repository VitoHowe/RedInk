# 多阶段构建 - 构建阶段
FROM node:18-alpine AS builder

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装依赖 (使用 npm install 避免 Alpine 上的 npm ci 问题)
RUN npm install --frozen-lockfile && npm cache clean --force

# 复制源代码
COPY . .

# 构建 TypeScript 项目
RUN npm run build

# 生产阶段
FROM node:18-alpine

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 只安装生产依赖
RUN npm install --production --frozen-lockfile && npm cache clean --force

# 从构建阶段复制编译后的代码
COPY --from=builder /app/dist ./dist

# 复制必要的配置文件
COPY text_providers.yaml ./
COPY image_providers.yaml ./
COPY prompts ./prompts

# 创建输出目录
RUN mkdir -p output history

# 暴露端口
EXPOSE 12398

# 设置环境变量
ENV NODE_ENV=production \
    PORT=12398 \
    HOST=0.0.0.0

# 启动应用
CMD ["node", "dist/app.js"]
