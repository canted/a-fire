// Production routes/API, isolated database only; run through the owned browser harness.
const { createRequire } = require('node:module');
const r = createRequire(process.cwd() + '/package.json');
const { PrismaClient } = r('@prisma/client');
const { chromium, expect } = r('@playwright/test');
const url = new URL(process.env.DATABASE_URL);
if (url.pathname !== '/afire_remediation_20261029_test' || !['localhost','127.0.0.1'].includes(url.hostname)) throw Error('Isolated database required');
const prisma = new PrismaClient();
(async () => {
 let browser;
 try {
  const now = new Date(), email = `project-page-${crypto.randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email, username: 'Pagination Author', created_at: now, updated_at: now } });
  const project = await prisma.project.create({ data: { owner_id: user.id, name: 'Paged Project', created_at: now, updated_at: now } });
  await prisma.project.createMany({ data: Array.from({ length: 45 }, (_, index) => ({ owner_id: user.id, name: `Library Project ${index}`, created_at: now, updated_at: now })) });
  const room = await prisma.room.create({ data: { name: 'Historical Room', owner_id: user.id, created_at: now, updated_at: now } });
  const membership = await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } });
  await prisma.projectRoom.create({ data: { project_id: project.id, room_id: room.id, created_at: now } });
  await prisma.entry.createMany({ data: Array.from({length:35},()=>({ project_id: project.id, room_id: room.id, user_id: user.id, status: 'published', published_at: now, created_at: now, updated_at: now })) });
  const materials = [];
  for (let i=0;i<35;i++) materials.push(await prisma.entry.create({ data: { project_id: project.id, user_id: user.id, creation_origin: 'project_material', status: 'published', published_at: new Date(+now+i*1000), created_at: now, updated_at: now, project_intent: `Original ${i}` } }));
  const source = materials[34];
  await prisma.entry.createMany({data:Array.from({length:45},()=>({source_entry_id:source.id,room_id:room.id,user_id:user.id,status:'published',published_at:now,created_at:now,updated_at:now}))});
  const feedback = [];
  for (let i=0;i<35;i++) feedback.push(await prisma.entry.create({ data: { project_id: project.id, user_id: user.id, creation_origin: 'project_feedback', source_entry_id: source.id, status: 'published', published_at: new Date(+now+i*1000), created_at: now, updated_at: now, project_intent: `Saved response ${i}` } }));
  await prisma.document.createMany({ data: [...materials,...feedback].map(post => ({ docable_type: 'Post', docable_id: post.id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Content ${post.id}` }] }] }, created_at: now, updated_at: now })) });
  const resultHistory=[];
  for(let index=0;index<45;index++){
    const at=new Date(+now+index*1000);
    const round=await prisma.round.create({data:{room_id:room.id,host_id:user.id,name:`Result ${index}`,status:'archived',closed_at:at,created_at:at,updated_at:at}});
    resultHistory.push(await prisma.roundResult.create({data:{room_id:room.id,round_id:round.id,title:`Result ${index}`,published_at:at}}));
  }
  async function auth(path, body) { const response=await fetch('http://127.0.0.1:4117/api/v1/auth/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); if(!response.ok)throw Error('Authentication failed');const text=await response.text();return text?JSON.parse(text):null; }
  await auth('request_otp',{email});
  const otp=await prisma.oneTimeToken.findFirstOrThrow({where:{email},orderBy:{created_at:'desc'}});
  const session=await auth('verify_otp',{email,token:otp.token});
  browser=await chromium.launch({headless:true});
  const hiddenFixtureIds=[];
  for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
   const context=await browser.newContext({viewport,isMobile:viewport.width<500,hasTouch:viewport.width<500});
   await context.addInitScript(({session,legacy}) => { if(legacy){localStorage.setItem('accessToken',session.accessToken);localStorage.setItem('refreshToken',session.refreshToken);}else localStorage.setItem('afire.preview.session',JSON.stringify(session)); }, {session,legacy:process.env.AFIRE_BROWSER_FRONTEND==='legacy'});
   const page=await context.newPage();page.setDefaultTimeout(30000);
   try {
    await prisma.roomMembership.update({where:{id:membership.id},data:{disabled:false}});
    if(hiddenFixtureIds.length) await prisma.entry.updateMany({where:{id:{in:hiddenFixtureIds}},data:{status:"draft"}});
    const roomPages=[];
    const pages=[];const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    {
      const projectRole = process.env.AFIRE_BROWSER_FRONTEND === 'legacy' ? 'link' : 'button';
      const listing = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/projects' && response.ok());
      await page.goto('http://localhost:5187/app/projects');
      const first = await (await listing).json();
      expect(first.projects).toHaveLength(30); expect(first.nextCursor).toBeTruthy();
      await expect(page.getByRole(projectRole, { name: 'Library Project 0', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Load more projects', exact: true }).click();
      await expect(page.getByRole(projectRole, { name: 'Library Project 0', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Load more projects', exact: true })).toHaveCount(0);
    }
    page.on('response',response=>{if(new URL(response.url()).pathname===`/api/v1/projects/${project.id}/entries`&&response.ok())pages.push(response.json());});
    page.on('response',response=>{if(new URL(response.url()).pathname===`/api/v1/projects/${project.id}/room-posts`&&response.ok())roomPages.push(response.json());});
    const resultList=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v1/rooms/${room.id}/walls`&&response.ok());
    await page.goto(`http://localhost:5187/app/rooms/${room.id}/chat?wall=${resultHistory[10].id}`);
    const resultPage=await (await resultList).json();
    expect(resultPage.walls).toHaveLength(20);
    expect(resultPage.nextCursor).toBeTruthy();
    await expect(page.getByRole('heading',{name:'Result 10',exact:true})).toBeVisible();
    const legacy=process.env.AFIRE_BROWSER_FRONTEND==='legacy';
    await page.getByRole('button',{name:legacy?'Previous wall':'Previous collection',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Result 9',exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading',{name:'Result 9',exact:true})).toBeVisible();
    await page.getByRole('button',{name:legacy?'Next wall':'Next collection',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Result 10',exact:true})).toBeVisible();
    const memberPath=`/api/v1/rooms/${room.id}/members/${user.id}/posts`;
    const memberResponse=(cursor='')=>page.waitForResponse(response=>{
      const url=new URL(response.url());
      return url.pathname===memberPath&&url.searchParams.get('cursor')===cursor&&response.ok();
    });
    const initialMember=memberResponse();
    await page.goto(`http://localhost:5187/app/rooms/${room.id}/members/${user.id}`);
    const memberFirst=await (await initialMember).json();
    expect(memberFirst.entries).toHaveLength(20);
    expect(memberFirst.pagination.nextCursor).toBeTruthy();
    const memberIds=[...memberFirst.entries.map(post=>post.id)];
    let memberCursor=memberFirst.pagination.nextCursor;
    const moreName=process.env.AFIRE_BROWSER_FRONTEND==='legacy'?'Load more posts':'Load more';
    for(const count of [20,5]){
      const nextMember=memberResponse(memberCursor);
      await page.getByRole('button',{name:moreName,exact:true}).click();
      const response=await nextMember;
      expect(new URL(response.url()).searchParams.get('cursor')).toBeTruthy();
      const body=await response.json();expect(body.entries).toHaveLength(count);
      memberCursor=body.pagination.nextCursor;
      memberIds.push(...body.entries.map(post=>post.id));
      if(count===5)expect(body.pagination.nextCursor).toBeNull();
    }
    expect(new Set(memberIds).size).toBe(45);
    await expect(page.getByRole('button',{name:moreName,exact:true})).toHaveCount(0);
    const metadata=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v1/projects/${project.id}`);
    await page.goto(`http://localhost:5187/app/projects/${project.id}`);
    expect(await (await metadata).json()).toMatchObject({entries:[]});
    await expect(page.getByText('Original 34',{exact:true}).first()).toBeVisible();
    await expect(page.getByText('Original 0',{exact:true})).toHaveCount(0);
    for(let i=0;i<2;i++) {
      await page.getByRole('button',{name:'Load more',exact:true}).click();
      if(i===0) await expect(page.getByText('Saved response 34',{exact:true}).first()).toBeVisible();
    }
    await expect(page.getByText('Original 0',{exact:true}).first()).toBeVisible();
    await expect(page.getByRole('button',{name:'Load more',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'View all Room copies',exact:true}).click();
    const copies=page.getByRole('dialog',{name:'Room copies',exact:true});
    await expect(copies.getByText('Historical Room, 0 replies',{exact:true})).toHaveCount(20);
    await copies.getByRole('button',{name:'Load more copies',exact:true}).click();
    await expect(copies.getByText('Historical Room, 0 replies',{exact:true})).toHaveCount(40);
    await copies.getByRole('button',{name:'Load more copies',exact:true}).click();
    await expect(copies.getByText('Historical Room, 0 replies',{exact:true})).toHaveCount(45);
    await expect(copies.getByRole('button',{name:'Load more copies',exact:true})).toHaveCount(0);
    await copies.getByRole('button',{name:process.env.AFIRE_BROWSER_FRONTEND==='legacy'?'Close modal':'Close Room copies',exact:true}).click();
    await expect(page.getByText('Post by Pagination Author',{exact:true})).toHaveCount(30);
    await page.getByRole('button',{name:'Load more Room posts',exact:true}).click();
    await expect(page.getByText('Post by Pagination Author',{exact:true})).toHaveCount(35);
    await prisma.roomMembership.update({where:{id:membership.id},data:{disabled:true}});
    const revokedHistory=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v1/projects/${project.id}/room-posts`);
    await page.reload();
    expect((await (await revokedHistory).json()).entries).toEqual([]);
    await expect(page.getByText('Original 34',{exact:true}).first()).toBeVisible();
    await expect(page.getByText('Post by Pagination Author',{exact:true})).toHaveCount(0);
    for(const body of await Promise.all(roomPages)) expect(body.entries.length).toBeLessThanOrEqual(30);
    await page.goto(`http://localhost:5187/app/projects/${project.id}/entries/${materials[0].id}`);
    await expect(page.getByText('Original 0',{exact:true}).first()).toBeVisible();
    await page.reload();await expect(page.getByText('Original 0',{exact:true}).first()).toBeVisible();
    await page.goto(`http://localhost:5187/app/projects/${project.id}/entries/${source.id}`);
    await expect(page.getByText('Original 34',{exact:true}).first()).toBeVisible();
    await expect(page.getByText('Saved response 34',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Load more',exact:true}).click();
    await expect(page.getByText('Saved response 34',{exact:true}).first()).toBeVisible();
    await expect(page.getByText('Original 33',{exact:true})).toHaveCount(0);
    for(const body of await Promise.all(pages)) { expect(body.entries.length).toBeLessThanOrEqual(30); for(const entry of body.entries) expect(entry.submissions.length).toBeLessThanOrEqual(20); }
    await prisma.roomMembership.update({where:{id:membership.id},data:{disabled:false}});
    const hiddenPosts=await prisma.entry.createManyAndReturn({data:[
      ...Array.from({length:30},()=>({project_id:project.id,source_entry_id:null})),
      ...Array.from({length:20},()=>({project_id:null,source_entry_id:source.id})),
    ].map(scope=>({...scope,room_id:room.id,user_id:user.id,status:'published',creation_origin:'chat_attachment',published_at:new Date(+now+60000),created_at:now,updated_at:now}))});
    hiddenFixtureIds.push(...hiddenPosts.map(post=>post.id));
    await prisma.chatMessage.createMany({data:hiddenPosts.map(post=>({entry_id:post.id,room_id:room.id,author_id:user.id,body:'Expired attachment',masked_alias:'',content:{type:'image'},created_at:now,updated_at:now,fire_at:now,expires_at:new Date(+now-1000)}))});
    const hiddenHistory=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v1/projects/${project.id}/room-posts`&&response.ok());
    await page.goto(`http://localhost:5187/app/projects/${project.id}`);
    const hiddenHistoryBody=await (await hiddenHistory).json();
    expect(hiddenHistoryBody.entries).toEqual([]);expect(hiddenHistoryBody.nextCursor).toBeTruthy();
    await expect(page.getByText('Post by Pagination Author',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Load more Room posts',exact:true}).click();
    await expect(page.getByText('Post by Pagination Author',{exact:true})).toHaveCount(30);
    await page.getByRole('button',{name:'View all Room copies',exact:true}).click();
    await expect(copies).toBeVisible();
    await expect(copies.getByText('Historical Room, 0 replies',{exact:true})).toHaveCount(0);
    await copies.getByRole('button',{name:'Load more copies',exact:true}).click();
    await expect(copies.getByText('Historical Room, 0 replies',{exact:true})).toHaveCount(20);
    expect(errors).toEqual([]);
    console.log(`PASS Project pagination ${viewport.width}px: 45 Round results with bounded list and deep-link neighbor/reload navigation; 70 Entries, multi-page feedback group, older direct link/reload, scoped detail, paged Room history/revocation, 45 copies through bounded dialogs, no full history preload; expired Chat-only first pages continue to authorized history and copies.`);
   } finally {await context.close();}
  }
 } finally {await browser?.close();await prisma.$disconnect();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
