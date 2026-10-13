import { createServerlessHandler } from './serverless.mjs';

export function createNetlifyHandler(options={}) {
  return createServerlessHandler({...options,platform:'Netlify',configure:(env,context)=>({
    ...env,NETLIFY:'true',NODE_ENV:'production',PUBLIC_ORIGIN:env.PUBLIC_ORIGIN||env.URL||context.site?.url||''
  })});
}
