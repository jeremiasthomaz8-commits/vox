import { connectDatabase } from '../../server/db.mjs';
import { expirePhotos } from '../../server/photos.mjs';

export default async () => {
  if(process.env.VOX_DATABASE!=='supabase')throw Error('A retenção online exige Supabase.');
  const db=await connectDatabase({...process.env,NETLIFY:'true'});
  try {await expirePhotos(db);}finally{await db.close();}
  return new Response(null,{status:204});
};
export const config = { schedule: '*/10 * * * *' };
