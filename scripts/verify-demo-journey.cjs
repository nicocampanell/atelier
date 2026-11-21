// Integrated demo journey: real extension, API and frontend, isolated throwaway data.
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'); const path=require('node:path'); const os=require('node:os');
const {createRequire}=require('node:module'); const assert=require('node:assert/strict');
const backend=process.env.ATELIER_BACKEND_ROOT || path.resolve(__dirname, '..');
const web=process.env.ATELIER_WEB_ROOT || path.resolve(backend, '../infinite-canvas-frontend-4a2f39/web');
const base='http://127.0.0.1:3251', front='http://127.0.0.1:5181', token='isolated-demo-test-token';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-journey-')); const children=[]; let ctx,uiPage;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(label,fn,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await pause(250);}throw Error('Timed out: '+label);}
function run(cmd,args,cwd,env={}){const p=spawn(cmd,args,{cwd,env:{...process.env,...env},detached:true,stdio:['ignore','pipe','pipe']});let log='';p.stdout.on('data',d=>log+=d);p.stderr.on('data',d=>log+=d);children.push(p);return {p,log:()=>log};}
async function api(method,p,body){const r=await fetch(base+p,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json();assert(j.ok,method+' '+p+' HTTP '+r.status);return j.data;}
async function main(){
 const built=spawnSync('pnpm',['--dir','extension','build'],{cwd:backend,env:{...process.env,ATELIER_EXT_TEST:'1',ATELIER_EXT_SERVER_ORIGIN:base,ATELIER_EXT_OUTDIR:'.output-demo'},encoding:'utf8'});assert.equal(built.status,0,built.stderr);
 const bs=run('pnpm',['exec','next','dev','--port','3251'],backend,{ATELIER_TOKEN:token,ATELIER_DATA_DIR:path.join(temp,'data'),NEXT_DIST_DIR:'.next-demo',EMBEDDING_API_KEY:'',GEMINI_API_KEY:'',TYPESAFE_API_KEY:''});
 const vs=run('npm',['run','dev','--','--host','127.0.0.1','--port','5181','--strictPort'],web,{VITE_API_TARGET:base});
 await until('servers ready',async()=>{if(bs.p.exitCode!==null)throw Error('Backend startup: '+bs.log().slice(-1500));if(vs.p.exitCode!==null)throw Error('Frontend startup: '+vs.log().slice(-1500));try{return (await fetch(base+'/api/health')).ok&&(await fetch(front)).ok;}catch{return false;}},120000);
 const pw=createRequire(path.join(backend,'extension/package.json'))('@playwright/test');
 const extPath=path.join(backend,'extension/.output-demo/chrome-mv3');
 ctx=await pw.chromium.launchPersistentContext(path.join(temp,'profile'),{headless:true,executablePath:process.env.CHROME_PATH||path.join(os.homedir(), '.agent-browser/browsers/chrome-157.0.8103.38/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1440,height:1000},args:['--disable-features=DisableLoadExtensionCommandLineSwitch','--disable-extensions-except='+extPath,'--load-extension='+extPath]});
 const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker'); const extId=new URL(sw.url()).host;
 const popup=await ctx.newPage();await popup.goto('chrome-extension://'+extId+'/popup.html');
 await popup.getByTestId('server').fill(base);await popup.getByTestId('token').fill(token);await popup.getByTestId('signin').click();await popup.getByTestId('project').first().waitFor();
 await popup.getByTestId('new-project').fill('Journey project');await popup.getByTestId('create-project').click();
 const project=await until('extension project',async()=>(await api('GET','/api/projects')).projects.find(p=>p.name==='Journey project'));
 await until('project selected',()=>sw.evaluate(async id=>(await chrome.storage.local.get('atelier.settings'))['atelier.settings']?.projectId===id,project.id));await popup.close();
 console.log('PASS extension sign-in and project selection');
 const ui=await ctx.newPage();uiPage=ui;const errors=[];ui.on('pageerror',e=>errors.push(e.message));
 await ui.addInitScript(t=>{localStorage.setItem('atelier-token',t);globalThis.__fieldStarts=[];const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...args){if(m?.type==='start')globalThis.__fieldStarts.push({at:performance.now(),options:m.options});return post.call(this,m,...args);};},token);await ui.goto(front);await ui.getByRole('button',{name:'Open board Journey project',exact:true}).waitFor({timeout:30000});
 console.log('PASS server project visible in frontend');
 const source=await ctx.newPage();const url='https://example.com/?atelier-demo-journey=1';await source.goto(url);await source.bringToFront();
 await sw.evaluate(async u=>{const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs.find(t=>t.url===u);if(!tab)throw Error('capture tab missing');await globalThis.__atelierTest.handleMenuClick({menuItemId:'atelier-save-page',pageUrl:u},tab);},url);
 const save=await until('extension save ready',async()=>{const list=(await api('GET','/api/saves?limit=200')).saves;return list.find(s=>s.sourceUrl===url&&s.status==='ready');});
 assert((await api('GET','/api/projects/'+project.id+'/board')).items.some(i=>i.saveId===save.id));console.log('PASS extension save ready and placed on backend project');
 await ui.bringToFront();await ui.getByRole('button',{name:'Library',exact:true}).click();await ui.getByRole('main',{name:'Library'}).getByText(save.title,{exact:true}).first().waitFor({timeout:30000});console.log('PASS extension save visible in frontend library without reload');
 await ui.getByRole('button',{name:'Boards',exact:true}).click();const tile=ui.getByRole('button',{name:'Open board Journey project',exact:true});await tile.press('Enter');
 const block=ui.locator('[data-block]').filter({hasText:save.title}).first();await block.waitFor();
 await ui.getByRole('button',{name:'Search references (⌘K)',exact:true}).click();let searchRequests=0;ui.on('request',r=>{if(r.url().includes('/api/search?'))searchRequests++;});
 await ui.getByRole('combobox',{name:'Search references',exact:true}).fill('Example');const add=ui.getByRole('button',{name:'Add '+save.title+' to board',exact:true});await add.first().waitFor();await add.first().click();
 await until('backend search request',()=>searchRequests>0);console.log('PASS backend search returns saved reference');
 await ui.keyboard.press('Escape');await pause(800);
 let board=await until('second placement persisted',async()=>{const b=await api('GET','/api/projects/'+project.id+'/board');return b.items.filter(i=>i.saveId===save.id).length>=2?b:null;});
 const before=JSON.stringify(board.items);await ui.reload();await until('board after reload',async()=>(await ui.locator('[data-block]').filter({hasText:save.title}).count())>=2);assert.equal(JSON.stringify((await api('GET','/api/projects/'+project.id+'/board')).items),before);console.log('PASS search-to-board and reload persistence');
 const moved=ui.locator('[data-block]').filter({hasText:save.title}).first();const box=await moved.boundingBox();assert(box);console.log('Drag target '+JSON.stringify(box));await ui.screenshot({path:'/tmp/atelier-before-drag.png'});await ui.mouse.move(box.x+box.width/2,box.y+box.height/2);await ui.mouse.down();await ui.mouse.move(box.x+box.width/2+70,box.y+box.height/2+55,{steps:10});await ui.mouse.up();
 await until('drag persisted',async()=>JSON.stringify((await api('GET','/api/projects/'+project.id+'/board')).items)!==before);console.log('PASS board drag persisted to backend');
 await pause(700);const starts=await ui.evaluate(()=>globalThis.__fieldStarts.length);await ui.mouse.move(900,600);await ui.keyboard.down('Control');
 for(let i=0;i<10;i++){await ui.mouse.wheel(0,-8);await pause(25);}
 await ui.keyboard.up('Control');const during=await ui.evaluate(()=>globalThis.__fieldStarts.length);assert.equal(during,starts,'field rebuilt while zoom was continuous');
 await until('settled field rebuild',async()=>(await ui.evaluate(()=>globalThis.__fieldStarts.length))>starts);const endStarts=await ui.evaluate(()=>globalThis.__fieldStarts);assert.equal(endStarts.length,starts+1,'more than one settled field rebuild');
 assert(endStarts.at(-1).options.focusRadius>endStarts.at(-2).options.focusRadius,'field radius did not grow with zoom');assert.equal(endStarts.at(-1).options.gap,endStarts.at(-2).options.gap);console.log('PASS continuous zoom: no per-frame field rebuild, one settled scale change, gap unchanged');
 await until('camera persisted',async()=>Math.abs((await api('GET','/api/projects/'+project.id+'/board')).camera.zoom-board.camera.zoom)>.1);
 await ui.getByRole('button',{name:'Back to boards',exact:true}).click();await ui.getByRole('button',{name:'New board',exact:true}).click();const nameInput=ui.getByPlaceholder('Untitled board');await nameInput.fill('Frontend journey');await nameInput.press('Enter');
 const created=await until('frontend project creation',async()=>(await api('GET','/api/projects')).projects.find(p=>p.name==='Frontend journey'));console.log('PASS frontend-created board is a backend project');
 const reopened=await ctx.newPage();await reopened.goto('chrome-extension://'+extId+'/popup.html');await until('new project in extension list',async()=>(await reopened.locator('body').innerText()).includes('Frontend journey'));await reopened.close();console.log('PASS frontend project visible in extension');
 await ui.bringToFront();await ui.getByRole('button',{name:'Library',exact:true}).click();const card=ui.getByRole('article',{name:'link: '+save.title,exact:true});await card.hover();await card.getByRole('button',{name:'Add '+save.title+' to board',exact:true}).click();await ui.getByRole('menuitem',{name:'Delete reference',exact:true}).click();
 await ui.getByRole('button',{name:'Undo',exact:true}).click();await card.waitFor();assert((await api('GET','/api/saves/'+save.id)).id===save.id);console.log('PASS deleting a reference can be undone');
 await card.hover();await card.getByRole('button',{name:'Add '+save.title+' to board',exact:true}).click();await ui.getByRole('menuitem',{name:'Delete reference',exact:true}).click();await ui.mouse.move(1300,900);
 await until('delete committed',async()=>!(await api('GET','/api/saves?limit=200')).saves.some(s=>s.id===save.id),15000);await pause(5500);assert.equal(await card.count(),0,'deleted reference resurrected after refresh');assert(!(await api('GET','/api/projects/'+project.id+'/board')).items.some(i=>i.saveId===save.id));console.log('PASS deletion removes save and placements and stays deleted after refresh');
 await ui.screenshot({path:path.join(temp,'journey.png')});assert.deepEqual(errors,[]);console.log('PASS no frontend uncaught errors');console.log('Artifacts: '+temp);
}
main().catch(async e=>{console.error('FAIL '+e.message);if(uiPage){await uiPage.screenshot({path:'/tmp/atelier-journey-failure.png'}).catch(()=>{});console.log('Page '+uiPage.url());console.log((await uiPage.locator('body').innerText().catch(()=>'' )).slice(0,2500));}process.exitCode=1;}).finally(async()=>{if(ctx)await ctx.close();for(const p of children){try{process.kill(-p.pid,'SIGTERM');}catch{}}});
