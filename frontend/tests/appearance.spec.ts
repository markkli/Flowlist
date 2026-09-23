import { test, expect } from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/config' ? {auth_mode:'local'} : new URL(route.request().url()).pathname==='/api/dashboard' ? {queue:[],goals:[],stats:{current_streak:0,total_sessions:0,total_minutes:0},week_sessions:0,activity:[]} : []}));
  await page.goto('/');
});

test('appearance persists, independently toggles art, and resets',async({page})=>{
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByRole('radio',{name:'Coast',exact:false}).check();
  await expect(page.locator('.focus-atmosphere')).toHaveAttribute('src','/images/focus-coast.webp');
  await page.getByLabel('Pomodoro artwork',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.locator('.focus-atmosphere')).toBeHidden();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance','coast');
  await expect(page.locator('.focus-atmosphere')).toBeHidden();
  await page.getByRole('button',{name:'Plan',exact:true}).click();
  await expect(page.locator('.plan-atmosphere')).toBeVisible();
  await expect(page.locator('.plan-atmosphere')).toHaveAttribute('src','/images/focus-coast.webp');
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByRole('radio',{name:'Linen',exact:true}).check();
  await expect(page.getByLabel('Plan artwork',{exact:true})).toBeDisabled();
  await expect(page.locator('.plan-atmosphere')).toBeHidden();
  await page.getByRole('button',{name:'Reset appearance'}).click();
  await expect(page.getByRole('radio',{name:/Grove/})).toBeChecked();
  await expect(page.getByLabel('Pomodoro artwork',{exact:true})).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Appearance',exact:true})).toBeFocused();
});

test('every preset coordinates the workspace, controls and heatmap in both modes',async({page},testInfo)=>{
  await page.setViewportSize({width:1440,height:960});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const backgrounds = new Set<string>();
    const accents = new Set<string>();
    for(const preset of ['Grove','Coast','Hills','Linen','Sage','Slate','Clay']) {
      await page.getByRole('radio',{name:new RegExp(preset)}).check();
      await expect(page.locator('html')).toHaveAttribute('data-appearance',preset.toLowerCase());
      // Allow the reduced-motion color transition to finish painting.
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      const accent = await page.evaluate(()=>{
        const hex=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        return `rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`;
      });
      await expect(page.locator('#appearance-done')).toHaveCSS('background-color',accent);
      await expect(page.locator('#start-pomodoro .timer-time span')).toHaveCSS('color',accent);
      const colors = await page.evaluate(()=>{
        const style = (selector:string)=>getComputedStyle(document.querySelector(selector)!);
        // Resolve CSS Color 4 values to sRGB for actual rendered contrast.
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
        const context=canvas.getContext('2d')!;
        const luminance=(color:string)=>{
          context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);
          const rgb=Array.from(context.getImageData(0,0,1,1).data).slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
          return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
        };
        const contrast=(a:string,b:string)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
        const action=style('#appearance-done'),label=style('#start-pomodoro .timer-time span'),dial=style('#start-pomodoro');
        return {
          background:style('body').backgroundColor,
          action:action.backgroundColor,
          label:label.color,
          heat:style('.heatmap-scale i:last-child').backgroundColor,
          labelBackground:label.backgroundColor,
          contrast:[contrast(action.color,action.backgroundColor),contrast(label.color,dial.backgroundColor),contrast(dial.color,dial.backgroundColor),contrast(style('.appearance-modal > p').color,style('.appearance-modal').backgroundColor)],
        };
      });
      backgrounds.add(colors.background);
      accents.add(colors.action);
      expect(colors.label).toBe(colors.action);
      expect(colors.heat).toBe(colors.action);
      expect(colors.labelBackground).toBe('rgba(0, 0, 0, 0)');
      for(const ratio of colors.contrast) expect(ratio,`${preset} ${theme} contrast`).toBeGreaterThanOrEqual(4.5);
      if(['Grove','Coast','Hills'].includes(preset)) {
        await page.keyboard.press('Escape');
        await page.locator('.focus-card').screenshot({path:testInfo.outputPath(`dial-${preset}-${theme}.png`)});
        await page.getByRole('button',{name:'Appearance',exact:true}).click();
      }
    }
    expect(backgrounds.size,JSON.stringify([...backgrounds])).toBe(7);
    expect(accents.size,JSON.stringify([...accents])).toBe(7);
  }
  await page.getByRole('radio',{name:/Coast/}).check();
  await page.keyboard.press('Escape');
  await page.locator('#start-pomodoro').click();
  await expect(page.getByRole('dialog',{name:'Pomodoro timer',exact:true})).toBeVisible();
  const activeRing=await page.locator('#focus-orbit').evaluate(el=>getComputedStyle(el).backgroundImage);
  expect(activeRing).toContain('165, 203, 226');
});

for(const width of [375,768,1440]) test(`appearance and primary start fit both themes at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:width===768 ? 375 : 960});
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.getByRole('button',{name:'Appearance',exact:true}).click();
    for(const preset of ['Grove','Coast','Hills','Linen','Sage','Slate','Clay']) {
      await page.getByRole('radio',{name:new RegExp(preset)}).check();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.getByRole('radio',{name:/Coast/}).check();
    for(let i=0;i<12;i++) {await page.keyboard.press('Tab'); expect(await page.locator('#appearance-overlay').evaluate(el=>el.contains(document.activeElement))).toBe(true);}
    await page.locator('.appearance-modal').evaluate(el=>el.scrollTop=0);
    await page.screenshot({path:testInfo.outputPath(`appearance-${width}-${theme}.png`)});
    await page.keyboard.press('Escape');
    await page.locator('#start-pomodoro').scrollIntoViewIfNeeded();
    await expect(page.locator('#start-pomodoro')).toContainText('Start focus');
    await page.screenshot({path:testInfo.outputPath(`focus-${width}-${theme}.png`),fullPage:true});
  }
});
