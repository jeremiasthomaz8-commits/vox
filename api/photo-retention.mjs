import { createVercelRetentionHandler } from '../server/vercel.mjs';

export default { fetch:createVercelRetentionHandler() };
