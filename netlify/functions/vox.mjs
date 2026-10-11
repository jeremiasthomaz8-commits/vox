import { createNetlifyHandler } from '../../server/netlify.mjs';

export default createNetlifyHandler();
export const config = { path: '/api/*' };
