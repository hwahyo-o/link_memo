import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // base를 relative 경로('./')로 설정하여 깃허브 페이지의 서브 디렉토리 주소에서도 에셋을 정상적으로 불러오도록 방어합니다.
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        pkm: fileURLToPath(new URL('pkm.html', import.meta.url))
      }
    }
  }
});
