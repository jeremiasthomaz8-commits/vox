import serverlessHttp from 'serverless-http';
import { createApp } from './index.mjs';
import { connectDatabase } from './db.mjs';
import { runtimeConfig } from './runtime.mjs';

// Adapt modern Request/Response functions to the existing Node HTTP routes.
export function createServerlessHandler({env=process.env,connect=connectDatabase,photoKey=null,configure,platform='Vox'}={}) {
  let initialized;
  const settings=context=>{
    if(env.VOX_DATABASE!=='supabase')throw Error(platform+' exige VOX_DATABASE=supabase.');
    return configure(env,context);
  };
  async function initialize(context) {
    const privateEnv=settings(context),config=runtimeConfig(privateEnv),db=await connect(privateEnv);
    try {
      if(await db.prepare('SELECT 1 FROM evaluations WHERE demo=1 LIMIT 1').get())throw Error('Banco de produção contém demonstrações.');
      if(!(await db.prepare('SELECT 1 FROM users LIMIT 1').get()))throw Error('Provisione os acessos antes da publicação.');
      const app=await createApp({db,...config,photoKey,retentionInterval:false});
      return {app,invoke:serverlessHttp(app.server,{binary:['image/*','application/pdf','font/*']})};
    }catch(error){await db.close();throw error;}
  }
  const handler=async(request,context={})=>{
    try {
      // A failed cold start can retry later, without keeping a rejected promise.
      initialized ||= initialize(context).catch(error=>{initialized=undefined;throw error;});
      const {invoke}=await initialized,url=new URL(request.url);
      const headers=Object.fromEntries(request.headers);
      headers.host=url.host;
      // Use platform metadata and the actual URL, never visitor forwarding headers.
      headers['x-forwarded-proto']=url.protocol.slice(0,-1);
      const chunks=[];let size=0;
      if(request.body)for await(const chunk of request.body){
        size+=chunk.byteLength;
        if(size>400000)return Response.json({error:'O envio excede o tamanho permitido.'},{status:413,headers:{'Cache-Control':'no-store'}});
        chunks.push(Buffer.from(chunk));
      }
      const output=await invoke({version:'2.0',rawPath:url.pathname,rawQueryString:url.search.slice(1),headers,
        requestContext:{requestId:context.requestId,http:{method:request.method,sourceIp:context.ip||'unknown'}},
        body:Buffer.concat(chunks).toString('base64'),isBase64Encoded:true},{});
      const responseHeaders=new Headers(output.headers);
      for(const cookie of output.cookies||[])responseHeaders.append('Set-Cookie',cookie);
      const bytes=Buffer.from(output.body,output.isBase64Encoded?'base64':'utf8');
      return new Response(request.method==='HEAD'||[204,304].includes(output.statusCode)?null:bytes,{status:output.statusCode,headers:responseHeaders});
    }catch(error){
      console.error(JSON.stringify({event:'function_error',error:error.code||error.name}));
      return Response.json({error:'O serviço está temporariamente indisponível. Tente novamente.'},{status:503,headers:{'Cache-Control':'no-store'}});
    }
  };
  handler.close=async()=>{if(initialized){const {app}=await initialized;app.server.emit('close');await app.db.close();initialized=undefined;}};
  return handler;
}
