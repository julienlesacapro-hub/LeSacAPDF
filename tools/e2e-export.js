// Test de l'export multi-formats (PNG, JPEG, Word, Word+images, ODT, texte).
// Usage : node tools/serve.js 8765 & node tools/e2e-export.js <test.pdf> <dossier>
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const [pdf, out] = process.argv.slice(2);
const ok = (c, m) => { if (!c) throw new Error('ÉCHEC : ' + m); console.log('✓ ' + m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8765/');
  await p.setInputFiles('#filePdf', pdf);
  await p.waitForFunction(() => document.querySelectorAll('.page').length === 3); await p.waitForTimeout(500);
  // une annotation texte, pour vérifier qu'elle est exportée
  const page1 = p.locator('.page').first(), bb = await page1.boundingBox();
  await p.locator('.tool[data-tool=text]').tap();
  await page1.locator('.layer').tap({ position: { x: bb.width * 0.5, y: bb.height * 0.05 } });
  await p.waitForSelector('#shText.on'); await p.locator('#txtArea').fill('Annotation export Élise'); await p.locator('#txtOk').tap();
  await p.waitForTimeout(300);
  const run = async (fmt, setup, label) => {
    await p.locator('#btnSave').tap(); await p.waitForTimeout(300);
    await p.locator('#saveFmt [data-f=' + fmt + ']').tap();
    if (setup) await setup();
    if (label) await p.screenshot({ path: path.join(out, 'form-' + label + '.png') });
    await p.locator('#saveGo').tap();
    await p.waitForSelector('#saveDone:not([hidden])', { timeout: 20000 }).catch(async e => { console.log('TOAST:', await p.locator('#toast').textContent(), errs); throw e; });
    const info = await p.locator('#doneInfo').textContent();
    if (label) await p.screenshot({ path: path.join(out, 'done-' + label + '.png') });
    const [d] = await Promise.all([p.waitForEvent('download'), p.locator('#doneDl').tap()]);
    const f = path.join(out, d.suggestedFilename()); await d.saveAs(f);
    await p.locator('#doneClose').tap(); await p.waitForTimeout(400);
    console.log('  ' + fmt + ' → ' + d.suggestedFilename() + ' (' + info + ')');
    return f;
  };
  await run('img', null, 'png');
  await run('img', async () => { await p.locator('input[name=imgType][value=jpg]').check(); await p.selectOption('#imgDpi', '96'); });
  await run('docx', null, 'docx');
  await run('docx', async () => { await p.locator('#txtImages').check(); });
  await run('odt', async () => { await p.locator('#txtImages').uncheck(); });
  await run('txt');
  ok(!errs.length, 'aucune erreur JavaScript ' + errs.join('|'));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
