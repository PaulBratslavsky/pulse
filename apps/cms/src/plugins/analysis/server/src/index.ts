import { register } from './register';
import { bootstrap } from './bootstrap';
import { destroy } from './destroy';
import { config } from './config';
import { services } from './services';

export { register, bootstrap, destroy, config, services };

export const createServer = () => ({
  register,
  bootstrap,
  destroy,
  config,
  services,
});

export default createServer;
