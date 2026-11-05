#!/usr/bin/env node
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const out=path.join(root,'tmp/round-walkthrough');
const url=pathToFileURL(path.join(out,'A Round Together.html')).href;
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1000,height:1000}});
 const errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())});
 await page.goto(url);
 const frame=page.frameLocator('iframe');
 await frame.locator('[data-testid="board-workspace-frame"]').waitFor();
 await frame.locator('body').evaluate(()=>document.fonts.ready);
 const live=await sharp(path.join(out,'actual-app-wall.png')).raw().toBuffer();
 const frozen=await sharp(await page.locator('iframe').screenshot()).raw().toBuffer();
 assert.deepEqual(frozen,live,'Frozen wall must match the actual app screenshot pixel-for-pixel.');
 const identityFont=await frame.locator('[data-testid="post-avatar-wall-Will"]').evaluate(el=>getComputedStyle(el.nextElementSibling).fontFamily);
 assert.match(identityFont,/Barlow Condensed/);
 for(let step=0;step<25;step++){
  assert.equal(await page.locator('[data-step]').getAttribute('data-step'),String(step));
  if(step===10) await page.frames()[1].evaluate(()=>window.scrollTo(0,100));
  if(step===11||step===12) assert.equal(await page.frames()[1].evaluate(()=>scrollY),100,'No scroll jump within the composer');
  if(step===21){
   await page.waitForFunction(()=>{const audio=document.querySelector('[data-testid="global-audio-element"]');return audio&&!audio.paused&&audio.currentTime>.1});
   await page.getByRole('button',{name:/^Pause /}).click();
   assert.equal(await page.locator('[data-step]').getAttribute('data-step'),String(step));
   assert.equal(await page.locator('[data-testid="global-audio-element"]').evaluate(audio=>audio.paused),true);
  }
  if(step>=22&&step<=23) assert.equal(await page.locator('[data-comment-count]').getAttribute('data-comment-count'),String(step-21));
  assert.doesNotMatch(await page.locator('body').innerText(),/private cover pool|private contributions|Will’s cover is already in/i);
  if(step<24)await page.locator('footer button').last().click();
 }
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:844});
  for(const step of [0,6,8,11,16,20,21,23,24]){
   await page.goto(url+'#'+step);await page.reload();
   await page.locator(`[data-step="${step}"]`).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
 }
 await page.getByRole('button',{name:'Credits',exact:true}).click();
 await page.getByRole('heading',{name:'Credits & controls'}).waitFor();
 await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('heading',{name:'Credits & controls'}).count(),0);
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 console.log('PASS: exact app wall pixels, real username font, 25 steps, stable composer scroll, first recording and two comments, four viewport widths, credits, zero external requests.');
}finally{await browser.close()}
