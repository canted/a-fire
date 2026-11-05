// Run from repository root. All database writes are forced to the isolated remediation database.
// Requires its migrations to be current; fixture data is additive and local-only.
const fs = require('node:fs');
const {createRequire} = require('node:module');
const {spawn} = require('node:child_process');
const requireRepo = createRequire(process.cwd()+'/package.json');
const {parse} = requireRepo('dotenv');
const settings = parse(fs.readFileSync('.env.test'));
const url = new URL(settings.TEST_DATABASE_URL || settings.DATABASE_URL);
if (!['localhost','127.0.0.1'].includes(url.hostname)) throw Error('Local only');
url.pathname='/afire_remediation_20261029_test';
const env={...process.env,...settings,NODE_ENV:'test',DATABASE_URL:url.toString(),TEST_DATABASE_URL:url.toString(),API_PORT:'4117',TEST_API_PORT:'4117',TEST_FRONTEND_PORT:'5187',VITE_DEV_SERVER_PORT:'5187',VITE_API_DEV_ORIGIN:'http://127.0.0.1:4117',VITE_API_PROXY_TARGET:'http://127.0.0.1:4117',VITE_HMR_PORT:'5187',VITE_HMR_HOST:'127.0.0.1',VITE_HOCUSPOCUS_URL:'http://127.0.0.1:4117/hocuspocus',PLAYWRIGHT_BASE_URL:'http://localhost:5187',EXPO_PUBLIC_API_URL:'http://127.0.0.1:4117/api',EXPO_OFFLINE:'1',CI:'1',BREVO_SMTP_SERVER:'127.0.0.1',BREVO_SMTP_PORT:'2527',BREVO_SMTP_LOGIN:'',BREVO_SMTP_PASSWORD:''};
const legacy=process.env.AFIRE_BROWSER_FRONTEND==='legacy';
const projectOnly=process.env.AFIRE_BROWSER_PROJECT_ONLY==='1';
const children=[];
let smtp;
function start(args,name){const fd=fs.openSync('/tmp/afire-room-browser-'+name+'.log','w');const child=spawn('pnpm',args,{env:['expo','vite'].includes(name)?{...env,NODE_ENV:'development'}:env,stdio:['ignore',fd,fd],detached:true});children.push(child);return child;}
async function ready(address,child){const until=Date.now()+120000;while(Date.now()<until){if(child.exitCode!==null)throw Error('Server stopped before readiness');try{const r=await fetch(address,{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Readiness timeout');}
(async()=>{try{
const net=require('node:net');for(const port of [4117,5187])await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve));});
smtp=net.createServer(socket=>{socket.setEncoding('utf8');socket.write('220 localhost test SMTP\r\n');let buffer='',data=false;socket.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);if(data){if(line==='.') {data=false;socket.write('250 accepted\r\n');}continue;}if(/^DATA$/i.test(line)){data=true;socket.write('354 send data\r\n');}else if(/^QUIT$/i.test(line)){socket.end('221 bye\r\n');}else socket.write('250 localhost\r\n');}});});
await new Promise((resolve,reject)=>{smtp.once('error',reject);smtp.listen(2527,'127.0.0.1',resolve);});
const api=start(['dev:api'],'api');const vite=legacy?start(['exec','vite','--host','127.0.0.1','--port','5187','--strictPort'],'vite'):start(['--dir','frontend','exec','expo','start','--web','--localhost','--port','5187'],'expo');
await Promise.all([ready('http://127.0.0.1:4117/api/v1/health',api),ready('http://localhost:5187',vite)]);
console.log(`Isolated API and ${legacy?'Vite':'Expo'} browser frontend ready.`);
const child=spawn('node',[projectOnly?'tests/e2e/projects/project-pagination.browser.cjs':legacy?'tests/e2e/rooms/legacy-round-contribution.browser.cjs':'tests/e2e/expo/room-sharing.browser.cjs'],{env,stdio:'inherit'});
process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
if(process.exitCode===0&&!projectOnly){const pagination=spawn('node',['tests/e2e/projects/project-pagination.browser.cjs'],{env,stdio:'inherit'});process.exitCode=await new Promise((resolve,reject)=>{pagination.once('error',reject);pagination.once('exit',code=>resolve(code??1));});}
}finally{smtp?.close();for(const child of children){try{process.kill(-child.pid,'SIGTERM');}catch{}}}})().catch(error=>{console.error(error.message);process.exitCode=1;});
