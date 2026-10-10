// Resolve deployment settings without depending on a particular hosting provider.
export function runtimeConfig(env=process.env) {
  const production=env.NODE_ENV==='production',render=env.RENDER==='true';
  const value=env.PUBLIC_ORIGIN || (render?env.RENDER_EXTERNAL_URL:'') || '';
  let publicOrigin='';
  if(value) {
    let url;
    try {url=new URL(value);}catch {throw Error('PUBLIC_ORIGIN deve ser um endereço completo válido.');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
      throw Error('PUBLIC_ORIGIN deve conter apenas a origem, sem usuário, caminho ou parâmetros.');
    publicOrigin=url.origin;
  }
  const trustProxy=env.TRUST_PROXY==='true',photoEnabled=env.PHOTO_CAPTURE_ENABLED==='true';
  if(production&&(env.LEGAL_REVIEW_APPROVED!=='true'||!trustProxy||!publicOrigin.startsWith('https://')))
    throw Error('Produção exige revisão municipal aprovada, proxy HTTPS confiável e PUBLIC_ORIGIN (ou RENDER_EXTERNAL_URL). Veja docs/deployment.md.');
  if(production&&photoEnabled&&env.PHOTO_PRIVACY_APPROVED!=='true')
    throw Error('Aprovação da política de fotografias necessária em produção. Veja docs/operations.md.');
  const port=Number(env.PORT || (render?10000:3000));
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT deve ser um inteiro de 1 a 65535.');
  return {production,publicOrigin,trustProxy,photoEnabled,host:env.HOST || (render?'0.0.0.0':'127.0.0.1'),port};
}
