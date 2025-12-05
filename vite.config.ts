import path from 'path';
import { defineConfig, loadEnv } from 'vite';
// Import necessary modules for __dirname replacement in ESM context
import { fileURLToPath } from 'url';
import { dirname } from 'path';


export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // Define __dirname for ESM context
    const __dirname = dirname(fileURLToPath(import.meta.url));
    return {
      server: {
        port: 3002, // Changed port to 3002
        host: '0.0.0.0',
      },
      plugins: [],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});