# 构建阶段
FROM node:18-alpine AS builder

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装依赖 (使用 npm 因为项目使用 pnpm-lock.yaml 但我们用 npm 也可以)
RUN npm install

# 复制源代码
COPY . .

# 构建 Vue 应用
RUN npm run build

# 生产阶段 - Nginx
FROM nginx:alpine

# 复制构建产物到 Nginx 默认目录
COPY --from=builder /app/dist /usr/share/nginx/html

# 复制 Nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 暴露端口
EXPOSE 12399

# 启动 Nginx
CMD ["nginx", "-g", "daemon off;"]
