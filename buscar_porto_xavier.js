// Script Playwright - Buscar PORTO XAVIER no portal INMET e baixar o CSV do gráfico
// Uso:
//   npm init -y
//   npm i playwright
//   npx playwright install chromium
//   node buscar_porto_xavier.js

const path = require('path');
const { chromium } = require('playwright');

(async () => {
  // Chromium puro (sem Edge/Chrome). O build padrão do Playwright 1.64
  // (chromium-1248) está bloqueado pelo Device Guard nesta máquina
  // (erro "spawn UNKNOWN"), mas o build chromium-1243 executa normalmente.
  // Por isso apontamos o executablePath para o 1243.
  const browser = await chromium.launch({
    headless: false,
    executablePath:
      'C:\\Users\\shuan\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    console.log('Abrindo https://portal.inmet.gov.br/ ...');
    await page.goto('https://portal.inmet.gov.br/', { waitUntil: 'domcontentloaded' });

    const searchInput = page.locator('#search');

    console.log('Aguardando campo #search ...');
    await searchInput.waitFor({ state: 'visible', timeout: 30000 });

    console.log('Digitando PORTO XAVIER ...');
    await searchInput.click();
    await searchInput.fill(''); // limpa
    await searchInput.pressSequentially('PORTO XAVIER', { delay: 100 });

    // O autocomplete é jQuery UI: <ul class="ui-autocomplete"><li>...</li></ul>
    const options = page.locator('ul.ui-autocomplete li');
    console.log('Aguardando opções do autocomplete ...');
    await options.first().waitFor({ state: 'visible', timeout: 15000 });

    // Loga as opções encontradas (ajuda a depurar)
    const count = await options.count();
    console.log(`Opções encontradas: ${count}`);
    for (let i = 0; i < count; i++) {
      console.log(` - [${i}] ${await options.nth(i).innerText()}`);
    }

    // Seleciona a opção que contém PORTO XAVIER (primeira ocorrência)
    const alvo = options.filter({ hasText: 'PORTO XAVIER' }).first();
    console.log('Clicando na opção PORTO XAVIER ...');
    await alvo.click();

    // Aguarda a navegação / carregamento resultante da seleção
    await page.waitForTimeout(5000);
    console.log('URL atual:', page.url());

    await page.screenshot({ path: 'porto-xavier-resultado.png', fullPage: true });
    console.log('Screenshot salvo em porto-xavier-resultado.png');

    // --- Baixar o CSV do gráfico "Condições Diárias" (Highcharts) ---
    console.log('Rolando até o gráfico Condições Diárias ...');
    const grafico = page.locator('text=Condições Diárias').first();
    await grafico.waitFor({ state: 'visible', timeout: 20000 });
    await grafico.scrollIntoViewIfNeeded();

    console.log('Abrindo menu de exportação do gráfico ...');
    const exportBtn = page.locator('.highcharts-contextbutton').first();
    await exportBtn.waitFor({ state: 'visible', timeout: 15000 });
    // <g> dentro de SVG: clique via JS é mais confiável
    await exportBtn.evaluate((el) => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const downloadCsv = page.locator('.highcharts-menu-item', { hasText: 'Download CSV' });
    await downloadCsv.waitFor({ state: 'visible', timeout: 15000 });
    console.log('Clicando em Download CSV ...');

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await downloadCsv.click();
    const download = await downloadPromise;

    const destino = path.join(__dirname, 'porto-xavier.csv');
    await download.saveAs(destino);
    console.log('CSV salvo em:', destino);
  } catch (err) {
    console.error('Erro:', err);
    await page.screenshot({ path: 'erro.png' }).catch(() => {});
  } finally {
    // Mantém o navegador aberto 3s para visualização antes de fechar
    await new Promise((r) => setTimeout(r, 3000));
    await browser.close();
  }
})();
