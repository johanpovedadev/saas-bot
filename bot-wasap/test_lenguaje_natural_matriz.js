'use strict';
/**
 * Matriz de lenguaje natural (3 oct 2026): 37 frases humanas (preguntas sobre el
 * pedido y el catálogo, pedidos, cortesía, dudas del negocio, ruido) x 7 fases
 * del flujo de Mundo Helados, con la IA APAGADA a propósito. Mide el "piso"
 * determinista: lo que el bot hace aunque Gemini no esté disponible (cuota
 * agotada, caída). Invariantes por cada mensaje: nunca queda en silencio, nunca
 * lanza una excepción, nunca pierde ni cambia el carrito con una pregunta, nunca
 * responde "no entendí / opción no válida" a una pregunta, cortesía o duda, y
 * nunca guarda una pregunta como dirección o teléfono.
 * Uso: node test_lenguaje_natural_matriz.js
 */
process.env.BUSINESS_KEY='heladeria'; process.env.LION_DISABLE_AI='1'; process.env.LOG_LEVEL='fatal'; process.env.TIME_WRITING_SIMULATION_MS='1';
const R=__dirname.replace(/\\/g,'/')+'/';
process.chdir(R);
const handler=require(R+'handlers/handler.js'), fr=require(R+'handlers/flowRegistry'), hf=require(R+'handlers/flows/heladeria.flow.js'), PHASE=require(R+'utils/phases');
fr.register('heladeria',hf);fr.register('ICE_CREAM',hf);
const log=console.log; console.log=()=>{}; console.warn=()=>{}; console.error=()=>{};
const productsCache=[
 {CodigoProducto:'P1',NombreProducto:'Volcán de Gomitas',Precio_Venta:'15000',Numero_de_Sabores:'3',Numero_de_Toppings:'0',Categoria:'Helados_Especiales'},
 {CodigoProducto:'P2',NombreProducto:'Copa Osito',Precio_Venta:'12000',Numero_de_Sabores:'2',Numero_de_Toppings:'3',Categoria:'Helados_Especiales'},
 {CodigoProducto:'P3',NombreProducto:'Cono',Precio_Venta:'4000',Numero_de_Sabores:'1',Numero_de_Toppings:'0',Categoria:'Helados_Clasicos'},
 {CodigoProducto:'S1',NombreProducto:'Lulo',Categoria:'Sabores_Helado'},{CodigoProducto:'S2',NombreProducto:'Chocolate',Categoria:'Sabores_Helado'},{CodigoProducto:'S3',NombreProducto:'Fresa',Categoria:'Sabores_Helado'},
 {CodigoProducto:'T1',NombreProducto:'Queso',Precio_Venta:'1000',Categoria:'Toppings'},{CodigoProducto:'T2',NombreProducto:'Gomitas trululu',Precio_Venta:'1000',Categoria:'Toppings'}];
const cart=()=>[{codigo:'P1',nombre:'Volcán de Gomitas',precio:15000,cantidad:1,sabores:['Lulo','Lulo','Lulo'],toppings:[],observaciones:''},{codigo:'P3',nombre:'Cono',precio:4000,cantidad:3,sabores:['Fresa'],toppings:[],observaciones:''}];
const total=c=>c.reduce((a,i)=>a+i.precio*i.cantidad,0);
const CATS={
 info:['¿cuánto llevo?','qué llevo en el pedido','me dices cuánto va','cuánto es el total','cuanto cuesta el cono','a como el volcan','precio de la copa osito','qué sabores hay','qué toppings tienen','qué opciones tengo','qué trae el volcán','tienen helado de fresa?'],
 orden:['quiero un cono de lulo','me regala una copa osito','dame 2 conos de fresa','me da un volcán','agrégame un cono','quiero otro cono igual'],
 social:['hola','buenas noches','gracias','ok','listo','muchas gracias, hasta luego','👍'],
 duda:['a qué hora cierran','tienen domicilio?','cuánto demora el domicilio','aceptan nequi','dónde están ubicados','hacen pedidos para eventos'],
 ruido:['asdkjaskjd','???','no entiendo','ayuda','quiero hablar con alguien','eso no era lo que pedí'],
};
const PH=['SELECCION_OPCION','HELADO_POST_ADD','CONFIRM_ORDER','CHECK_DIR','CHECK_TELEFONO','CHECK_PAGO','FINALIZE_ORDER'];
(async()=>{ const rows=[]; let n=0;
 for(const ph of PH) for(const [cat,list] of Object.entries(CATS)) for(const q of list){
  const sent=[]; const sock={sendMessage:async(j,t)=>sent.push(String(t)),getChatById:async()=>null};
  const ctx={sessions:{},mutedChats:new Set(),carts:{},productsCache,lastSent:{}};
  const JID='5731700'+String(10000+n++)+'@c.us';
  const s={phase:PHASE[ph],errorCount:0,carrito:cart(),order:ph==='FINALIZE_ORDER'?{items:cart(),address:'Cra 1 #1-1',name:'Juan',telefono:'3001234567',paymentMethod:'efectivo'}:{},lastMentionedProducts:[],lastBotReply:''};
  ctx.sessions[JID]=s; let err=null;
  try{ await handler.processIncomingMessage(sock,{from:JID,text:q},ctx);}catch(e){err=e.message;}
  const out=sent.join(' | ');
  const probs=[];
  if(err) probs.push('EXCEPCION '+err.slice(0,60));
  if(!out.trim()) probs.push('SILENCIO');
  if(cat!=='orden' && cat!=='ruido' && total(s.carrito||[])<27000 && ph!=='FINALIZE_ORDER') probs.push('CARRITO_CAMBIO');
  if(/Opci[oó]n no v[aá]lida|No entendí/i.test(out) && (cat==='info'||cat==='social'||cat==='duda')) probs.push('NO_ENTENDI_EN_'+cat);
  if(['CHECK_DIR'].includes(ph) && s.order && s.order.address && (cat==='info'||cat==='duda'||cat==='social') ) probs.push('GUARDO_COMO_DIRECCION');
  if(ph==='CHECK_TELEFONO' && s.order && s.order.telefono && (cat==='info'||cat==='duda'||cat==='social')) probs.push('GUARDO_COMO_TELEFONO');
  rows.push({ph,cat,q,probs,out:out.replace(/\n+/g,' / ').slice(0,110)});
 }
 const bad=rows.filter(r=>r.probs.length);
 log(bad.length===0 ? '✅ '+rows.length+' combinaciones frase x fase sin ningún problema' : '❌ '+bad.length+' de '+rows.length+' combinaciones con problema');
 const byProb={}; bad.forEach(r=>r.probs.forEach(p=>{(byProb[p]=byProb[p]||[]).push(r)}));
 for(const [p,a] of Object.entries(byProb)){ log('\n##',p,a.length); a.slice(0,200).forEach(r=>log(`  [${r.ph}] "${r.q}" -> ${r.out}`)); }
 process.exit(bad.length===0?0:1);})();
