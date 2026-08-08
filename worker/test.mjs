// Exercise every restriction the Worker claims to make. No wrangler needed:
// the handler is a plain module, so it runs in node with fetch stubbed.
import worker from './src/index.js';

const ENV = { GEMINI_API_KEY:'k-secret', MODEL:'gemini-robotics-er-2-preview',
              ALLOWED_ORIGINS:'https://abdu7rahman.github.io,http://127.0.0.1:8899' };
const GOOD='https://abdu7rahman.github.io';
let seen=null;
globalThis.fetch = async (url, init)=>{ seen={url, init};
  return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'[{"point":[500,500],"label":"cup"}]'}]}}]}),
    {status:200, headers:{'content-type':'application/json'}}); };

const body = JSON.stringify({contents:[{parts:[{text:'point at the cup'}]}]});
const req=(o={})=> new Request('https://w.dev/', {method:o.method||'POST',
  headers:Object.assign(o.origin===null?{}:{origin:o.origin||GOOD, 'content-type':'application/json'}, o.headers||{}),
  body:o.method==='OPTIONS'||o.method==='GET'?undefined:(o.body!==undefined?o.body:body)});

let pass=0, fail=0;
const check=(name, cond, extra='')=>{ cond?pass++:fail++;
  console.log((cond?'  ok   ':'  FAIL ')+name+(cond?'':'   '+extra)); };

console.log('restrictions:');
let r = await worker.fetch(req({origin:'https://evil.example'}), ENV);
check('rejects an unknown origin', r.status===403, 'got '+r.status);

r = await worker.fetch(req({origin:null}), ENV);
check('rejects a missing origin', r.status===403, 'got '+r.status);

r = await worker.fetch(req({method:'GET'}), ENV);
check('rejects GET', r.status===405, 'got '+r.status);

r = await worker.fetch(req({method:'OPTIONS'}), ENV);
check('answers the preflight', r.status===204 && r.headers.get('access-control-allow-origin')===GOOD,
      'got '+r.status+' '+r.headers.get('access-control-allow-origin'));

r = await worker.fetch(req(), {...ENV, ALLOWED_ORIGINS:''});
check('empty allowlist denies rather than allows all', r.status===500, 'got '+r.status);

r = await worker.fetch(req(), {...ENV, GEMINI_API_KEY:''});
check('missing key is a clear 500', r.status===500, 'got '+r.status);

r = await worker.fetch(req({body:'not json'}), ENV);
check('rejects non-JSON', r.status===400, 'got '+r.status);

r = await worker.fetch(req({body:JSON.stringify({nope:1})}), ENV);
check('rejects a body with no contents', r.status===400, 'got '+r.status);

r = await worker.fetch(req({headers:{'content-length':String(9*1024*1024)}}), ENV);
check('rejects an oversized declared body', r.status===413, 'got '+r.status);

r = await worker.fetch(req({body:JSON.stringify({contents:[{parts:[{text:'x'.repeat(7*1024*1024)}]}]})}), ENV);
check('rejects an oversized actual body', r.status===413, 'got '+r.status);

console.log('forwarding:');
seen=null;
r = await worker.fetch(req({body:JSON.stringify({contents:[{parts:[{text:'hi'}]}],
  generationConfig:{temperature:0.2}, model:'gemini-3.5-pro', apiKey:'theirs'})}), ENV);
check('forwards a good request', r.status===200, 'got '+r.status);
check('pins the model from env', seen.url.includes('gemini-robotics-er-2-preview') && !seen.url.includes('3.5-pro'), seen.url);
const sent=JSON.parse(seen.init.body);
check('drops fields the page is not allowed to set', sent.model===undefined && sent.apiKey===undefined,
      JSON.stringify(Object.keys(sent)));
check('keeps generationConfig', sent.generationConfig && sent.generationConfig.temperature===0.2);
check('sends the key upstream only', seen.init.headers['x-goog-api-key']==='k-secret');
const out = await r.text();
check('key never appears in the response', !out.includes('k-secret'));
// the model's answer is a JSON string inside JSON, so it comes back escaped --
// which is the point: the proxy re-serialises nothing and parses nothing
check('response passes through untouched', out === JSON.stringify({candidates:[{content:{parts:[{text:'[{"point":[500,500],"label":"cup"}]'}]}}]}), out.slice(0,80));
check('response carries CORS', r.headers.get('access-control-allow-origin')===GOOD);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
