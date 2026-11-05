import { chromium, expect } from "@playwright/test";

// Run against the production-component stories after starting Storybook.
const storybookUrl = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6006";
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:844}});
page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
try {
  {
await page.goto(`${storybookUrl}/iframe.html?id=rooms-chat--long-history&viewMode=story`);
const scroller=page.getByRole('main',{name:'Small Hours chat messages'});
await expect(scroller).toBeVisible({timeout:60000});
await expect(page.locator('#chat-1999')).toBeInViewport({timeout:10000});
console.log('Initial latest',await scroller.evaluate(el=>({top:el.scrollTop,height:el.scrollHeight,client:el.clientHeight,rows:el.querySelectorAll('[id^="chat-"]').length})));
await expect.poll(()=>page.locator('[id^="chat-"]').count()).toBeLessThan(100);
const initialTop=await scroller.evaluate(el=>el.scrollTop);
await scroller.hover();await page.mouse.wheel(0,-14000);
await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeLessThan(initialTop-10000);
await page.waitForTimeout(400);
const anchor=await scroller.evaluate(el=>{const bounds=el.getBoundingClientRect();const row=[...el.querySelectorAll('[id^="chat-"]')].find(row=>row.getBoundingClientRect().bottom>bounds.top&&row.getBoundingClientRect().top<bounds.bottom);return {id:row.id,y:row.getBoundingClientRect().top-bounds.top,top:el.scrollTop};});
console.log('Reading anchor',anchor);
await page.evaluate(async()=>{const {apiClient}=await import('/frontend/site/lib/api/client.ts');await apiClient.post('/v1/rooms/77/chat/messages',{body:'Incoming virtual message',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Incoming virtual message'}]}]}});window.dispatchEvent(new Event('pageshow'));});
await expect(page.getByRole('button',{name:'New messages. Scroll to bottom'})).toBeVisible({timeout:10000});
await expect.poll(()=>page.locator('#'+anchor.id).evaluate(el=>el.getBoundingClientRect().top)).toBeCloseTo(await scroller.evaluate(el=>el.getBoundingClientRect().top)+anchor.y,0);
console.log('Incoming message preserved reading anchor');
await page.getByRole('button',{name:'New messages. Scroll to bottom'}).click();
await expect(page.getByText('Incoming virtual message',{exact:true})).toBeInViewport();
console.log('Jump to latest works');
await scroller.evaluate(el=>el.scrollTop=0);
await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(1000);
await scroller.hover();await page.mouse.wheel(0,-20000);
await expect(page.locator('#chat-900')).toBeAttached({timeout:10000});
console.log('Older pagination loaded',await scroller.evaluate(el=>({top:el.scrollTop,rows:el.querySelectorAll('[id^="chat-"]').length})));


  }
  {
for(const [story,target] of [['rooms-chat--virtual-message-target','#chat-1500'],['rooms-chat--virtual-entry-replies','#reply-1500'],['rooms-chat--virtual-older-target','#chat-925']]){
 await page.goto(`${storybookUrl}/iframe.html?id=`+story+'&viewMode=story');
 await expect(page.locator(target)).toBeInViewport({timeout:20000});
 await expect.poll(()=>page.locator('[id^="chat-"],[id^="reply-"]').count()).toBeLessThan(100);
 console.log('Virtual deep link passed',target,await page.locator(target).boundingBox());
 await page.waitForTimeout(200);
 await expect(page.locator(target)).toBeInViewport();
}
await page.goto(`${storybookUrl}/iframe.html?id=rooms-chat-legacy--virtual-historical-replies&viewMode=story`);
await expect(page.getByText('Thread reply 3000',{exact:true})).toBeVisible({timeout:20000});
const threadScroll=page.locator('.visual-viewport-shell__scroll');
await threadScroll.evaluate(el=>el.scrollTop=el.scrollHeight);
await expect(page.getByText('Thread reply 3999',{exact:true})).toBeInViewport();
await expect.poll(()=>page.locator('[id^="chat-"]').count()).toBeLessThan(100);
console.log('Historical thread renders a bounded range through its last reply');
await page.goto(`${storybookUrl}/iframe.html?id=rooms-chat--long-history&viewMode=story`);
const scroll=page.getByRole('main',{name:'Small Hours chat messages'});
await expect(page.locator('#chat-1999')).toBeInViewport();
const surface=page.locator('#chat-1999 [data-chat-swipe-surface]');await surface.focus();await surface.press('ArrowRight');
await page.locator('#chat-1999').getByRole('button',{name:'Save to project'}).click();
await expect(page.getByRole('dialog',{name:'Save to project'})).toBeVisible();
await page.locator('.visual-viewport-shell__scroll').evaluate(el=>el.scrollTop=0);
await expect(surface).toBeAttached();
await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(surface).toBeFocused();
console.log('Save dialog retains its virtual trigger and restores focus');
await scroll.hover();await page.mouse.wheel(0,-9000);await page.waitForTimeout(200);
const anchor=await scroll.evaluate(el=>{const b=el.getBoundingClientRect();const row=[...el.querySelectorAll('[id^="chat-"]')].find(row=>row.getBoundingClientRect().bottom>b.top&&row.getBoundingClientRect().top<b.bottom);return {id:row.id,y:row.getBoundingClientRect().top-b.top};});
await page.setViewportSize({width:320,height:740});
await expect.poll(()=>page.locator('#'+anchor.id).evaluate(el=>el.getBoundingClientRect().top)).toBeCloseTo(await scroll.evaluate(el=>el.getBoundingClientRect().top)+anchor.y,0);
console.log('Width and viewport-height changes preserve the reading anchor');


  }
  {
await page.goto(`${storybookUrl}/iframe.html?id=rooms-chat--virtual-message-target&viewMode=story`);
const target=page.locator('#chat-1500');await expect(target).toBeInViewport();await page.waitForTimeout(200);
const before=await target.evaluate(el=>el.getBoundingClientRect().top);await target.getByRole('button',{name:'1 response. Open thread'}).click();
await expect(page.getByRole('textbox',{name:'Reply',exact:true})).toBeVisible();
await page.getByRole('button',{name:'Back to room',exact:true}).click();
await expect(target).toBeInViewport();await page.waitForTimeout(400);
const after=await target.evaluate(el=>el.getBoundingClientRect().top);console.log('Route return offset',before,after);expect(Math.abs(after-before)).toBeLessThan(1);
const scroll=page.getByRole('main',{name:'Small Hours chat messages'});
const anchor=await scroll.evaluate(el=>{const b=el.getBoundingClientRect();const r=[...el.querySelectorAll('[id^="chat-"]')].find(r=>r.getBoundingClientRect().bottom>b.top&&r.getBoundingClientRect().top<b.bottom);return{id:r.id,y:r.getBoundingClientRect().top-b.top};});
await page.locator('#'+anchor.id).evaluate(el=>{const parent=el.closest('[data-virtual-message-key]');const row=parent.querySelector('article');row.style.paddingBottom='120px';});
await expect.poll(()=>page.locator('#'+anchor.id).evaluate(el=>el.getBoundingClientRect().top)).toBeCloseTo(await scroll.evaluate(el=>el.getBoundingClientRect().top)+anchor.y,0);
console.log('Measured row growth preserves the reading anchor');
  }
} finally {
  await browser.close();
}
