import { register } from './register';
import { bootstrap } from './bootstrap';
import { destroy } from './destroy';
import { config } from './config';

export { register, bootstrap, destroy, config };

export const createServer = () => ({
  register,
  bootstrap,
  destroy,
  config,
});

export default createServer;
