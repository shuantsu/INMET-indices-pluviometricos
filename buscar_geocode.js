// buscar_geocode.js - CLI interativo para baixar o CSV do INMET por cidade.
// - Escolha uma cidade já salva em geocodes.json, ou
// - busque uma nova (via API de autocomplete), que é adicionada ao json,
// voltando ao menu em seguida.
// Uso: node buscar_geocode.js

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { stdin: input, stdout: output } = require('process');
const { chromium } = require('playwright');

const CIDADES_FILE = path.join(__dirname, 'geocodes.json');
// Chromium puro: o build 1248 está bloqueado pelo Device Guard (spawn UNKNOWN),
// o 1243 executa normalmente.
const CHROMIUM_EXE =
  'C:\\Users\\shuan\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';

function semAcento(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function carregarCidades() {
  if (!fs.existsSync(CIDADES_FILE)) return {};
  return JSON.parse(fs.readFileSync(CIDADES_FILE, 'utf8'));
}

function salvarCidades(banco) {
  fs.writeFileSync(CIDADES_FILE, JSON.stringify(banco, null, 2) + '\n');
}

function slug(nome) {
  return semAcento(nome.split('-')[0].trim().toLowerCase())
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

// Leitor linha a linha via async iterator: funciona tanto no terminal
// interativo quanto com stdin redirecionado (rl.question trava no 2º prompt com pipe).
const rl = readline.createInterface({ input, output, terminal: false });
const linhas = rl[Symbol.asyncIterator]();
async function perguntar(texto) {
  output.write(texto);
  const r = await linhas.next();
  if (r.done) throw new Error('EOF');
  return r.value;
}

async function autocomplete(termo) {
  const url =
    'https://apiprevmet3.inmet.gov.br/autocomplete/' + encodeURIComponent(semAcento(termo));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} no autocomplete`);
  return res.json();
}

async function baixarCsv(entry) {
  const browser = await chromium.launch({ executablePath: CHROMIUM_EXE });
  const context = await browser.newContext();
  // Atalho: o select do autocomplete só grava localStorage e recarrega '/'.
  await context.addInitScript(
    ({ custom, geocode }) => {
      localStorage.setItem('previsaoCidade', custom);
      localStorage.setItem('geoCode', String(geocode));
    },
    { custom: entry.custom, geocode: entry.geocode }
  );
  const page = await context.newPage();
  try {
    console.log(`Abrindo portal já em ${entry.nome} ...`);
    await page.goto('https://portal.inmet.gov.br/', { waitUntil: 'domcontentloaded' });
    await page.locator('text=Condições Diárias').first().waitFor({
      state: 'visible',
      timeout: 30000,
    });
    // "Download CSV" do Highcharts é gerado no browser (URL blob:).
    const csv = await page.evaluate(() => {
      const charts = (window.Highcharts && window.Highcharts.charts) || [];
      const chart = charts.find((c) => c && typeof c.getCSV === 'function');
      if (!chart) throw new Error('Gráfico Highcharts não encontrado');
      return chart.getCSV(true);
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const destino = path.join(__dirname, `${slug(entry.nome)}-${timestamp}.csv`);
    fs.writeFileSync(destino, '﻿' + csv);
    console.log('CSV salvo em:', destino);
  } finally {
    await browser.close();
  }
}

async function fluxoNovaCidade(rl, banco) {
  const digitado = (await perguntar('Digite a cidade (ex: Sao Borja RS): ')).trim();
  if (!digitado) return;
  const partes = semAcento(digitado).split(/\s+/);
  let uf = '';
  let nome = partes.join(' ');
  if (partes.length > 1 && partes[partes.length - 1].length === 2) {
    uf = partes[partes.length - 1].toLowerCase();
    nome = partes.slice(0, -1).join(' ');
  }
  const lista = await autocomplete(nome);
  if (!lista.length) {
    console.log(`Nenhum resultado para "${digitado}".`);
    return;
  }
  const candidatas = uf
    ? lista.filter((x) => semAcento(x.value).toLowerCase().endsWith('-' + uf))
    : lista;
  const mostrar = (candidatas.length ? candidatas : lista).slice(0, 10);
  console.log('Resultados:');
  mostrar.forEach((x, i) => console.log(`  ${i + 1}) ${x.value} (geocode ${x.geocode})`));
  const esc = (await perguntar('Escolha o número (0 = cancelar): ')).trim();
  const n = parseInt(esc, 10);
  if (!n || n < 1 || n > mostrar.length) return;
  const item = mostrar[n - 1];
  banco[digitado.toLowerCase()] = {
    geocode: item.geocode,
    nome: item.value,
    custom: item.custom,
    latitude: item.latitude,
    longitude: item.longitude,
  };
  salvarCidades(banco);
  console.log(`${item.value} adicionado ao geocodes.json.`);
}

(async () => {
  try {
    // Modo direto: node buscar_geocode.js "porto xavier"
    // Pula o menu, resolve a cidade (json ou API) e baixa o CSV.
    const direto = process.argv.slice(2).join(' ').trim();
    if (direto) {
      const banco = carregarCidades();
      const norm = semAcento(direto).toLowerCase();
      const chave = Object.keys(banco).find(
        (k) =>
          k === direto.toLowerCase() ||
          semAcento(banco[k].nome).toLowerCase() === norm ||
          semAcento(banco[k].nome).toLowerCase().startsWith(norm)
      );
      let entry = chave ? banco[chave] : null;
      if (!entry) {
        console.log(`"${direto}" não está no geocodes.json, buscando na API ...`);
        const partes = semAcento(direto).split(/\s+/);
        let uf = '';
        let nome = partes.join(' ');
        if (partes.length > 1 && partes[partes.length - 1].length === 2) {
          uf = partes[partes.length - 1].toLowerCase();
          nome = partes.slice(0, -1).join(' ');
        }
        const lista = await autocomplete(nome);
        const item =
          lista.find(
            (x) =>
              semAcento(x.value).toLowerCase().includes(nome.toLowerCase()) &&
              (!uf || semAcento(x.value).toLowerCase().endsWith('-' + uf))
          ) || lista[0];
        if (!item) throw new Error(`Nenhum resultado para "${direto}"`);
        entry = {
          geocode: item.geocode,
          nome: item.value,
          custom: item.custom,
          latitude: item.latitude,
          longitude: item.longitude,
        };
        banco[direto.toLowerCase()] = entry;
        salvarCidades(banco);
        console.log(`${item.value} adicionado ao geocodes.json.`);
      }
      await baixarCsv(entry);
      return;
    }

    while (true) {
      const banco = carregarCidades();
      const chaves = Object.keys(banco);
      console.log('\n=== INMET - CSV por cidade ===');
      chaves.forEach((k, i) => console.log(`${i + 1}) ${banco[k].nome} (geocode ${banco[k].geocode})`));
      console.log('N) Buscar nova cidade');
      console.log('0) Sair');
      const esc = ((await perguntar('Escolha: ')) || '').trim().toLowerCase();
      if (esc === '0' || esc === 'sair' || esc === 'q') break;
      if (esc === 'n' || esc === 'nova') {
        await fluxoNovaCidade(rl, banco);
        continue; // volta ao menu
      }
      const n = parseInt(esc, 10);
      if (!n || n < 1 || n > chaves.length) {
        console.log('Opção inválida.');
        continue;
      }
      await baixarCsv(banco[chaves[n - 1]]);
      // volta ao menu
    }
  } catch (err) {
    if (err.message !== 'EOF') console.error('Erro:', err.message);
  } finally {
    rl.close();
  }
})();
