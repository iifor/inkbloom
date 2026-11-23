import config from '../../vite.config';
export default { ...config, server: { host: '127.0.0.1', port: 5290, strictPort: true, hmr: false, watch: null } };
