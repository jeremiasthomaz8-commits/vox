import { ipAddress } from '@vercel/functions';
import { createHash,timingSafeEqual } from 'node:crypto';
import { createServerlessHandler } from './serverless.mjs';
import { connectDatabase } from './db.mjs';
import { runtimeConfig } from './runtime.mjs';
import { expirePhotos } from './photos.mjs';

function settings(env) {
  if(env.VERCEL_ENV&&env.VERCEL_ENV!=='production')throw Error('Previews não usam o banco de produção.');
  if(env.VOX_DATABASE!=='supabase')throw Error('Vercel exige VOX_DATABASE=supabase.');
  return {...env,VERCEL:'1',NODE_ENV:'production'};
}
export function createVercelHandler(options={}) {
  const invoke=createServerlessHandler({...options,platform:'Vercel',configure:settings});
  const handler=request=>invoke(request,{
    ip:request.headers.get('x-vercel-forwarded-for')||ipAddress(request)||'unknown',
    requestId:request.headers.get('x-vercel-id')||undefined
  });
  handler.close=invoke.close;
  return handler;
}
const hash=value=>createHash('sha256').update(value).digest();
export function createVercelRetentionHandler({env=process.env,connect=connectDatabase}={}) {
  return async request=>{
    const headers={'Cache-Control':'no-store'};
    if(request.method!=='GET')return new Response(null,{status:405,headers:{...headers,Allow:'GET'}});
    if(typeof env.CRON_SECRET!=='string'||env.CRON_SECRET.length<32)
      return Response.json({error:'A manutenção não está configurada.'},{status:503,headers});
    if(!timingSafeEqual(hash(request.headers.get('authorization')||''),hash('Bearer '+env.CRON_SECRET)))
      return Response.json({error:'Não autorizado.'},{status:401,headers});
    let db;
    try {
      const privateEnv=settings(env);runtimeConfig(privateEnv);db=await connect(privateEnv);
      return Response.json({removed:await expirePhotos(db)},{headers});
    }catch(error){
      console.error(JSON.stringify({event:'retention_error',error:error.code||error.name}));
      return Response.json({error:'Manutenção temporariamente indisponível.'},{status:503,headers});
    }finally{if(db)await db.close();}
  };
}
