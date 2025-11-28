/*
 * @Description: 
 * @Version: 2.0
 * @Autor: MyStery
 * @Date: 2025-11-28 12:32:19
 * @LastEditors: MyStery
 * @LastEditTime: 2025-11-28 12:32:30
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 12399,
    proxy: {
      '/api': {
        target: 'http://localhost:12398',
        changeOrigin: true
      }
    }
  }
})
