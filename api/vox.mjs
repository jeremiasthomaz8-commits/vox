import { createVercelHandler } from '../server/vercel.mjs';

const handler=createVercelHandler();
export default { fetch:handler };
