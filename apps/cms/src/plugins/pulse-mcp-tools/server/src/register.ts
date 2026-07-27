import type { Core } from '@strapi/strapi';

import { registerAllMcpTools } from './mcp';

export const register = ({ strapi }: { strapi: Core.Strapi }) => {
  registerAllMcpTools(strapi);
};
