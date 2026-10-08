// Salva os geocodes (IBGE) de cidades em um JSON único na pasta.
// Fonte: mesma API do autocomplete do portal INMET.
// Uso:
//   node salvar_geocodes.js "Uruguaiana RS" "Santiago RS" "Porto Xavier RS"
// Resultado: geocodes.json -> { "<cidade>": { geocode, nome, custom, ... } }

const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, 'geocodes.json');

function semAcento(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

async function buscar(cidade) {
  // A API do autocomplete espera só o nome (sem UF): "URUGUAIANA".
  // A UF, se informada ("Uruguaiana RS"), serve só para desambiguar.
  const partes = semAcento(cidade).trim().split(/\s+/);
  let uf = '';
  let nome = partes.join(' ');
  if (partes.length > 1 && partes[partes.length - 1].length === 2) {
    uf = partes[partes.length - 1].toLowerCase();
    nome = partes.slice(0, -1).join(' ');
  }
  const url =
    'https://apiprevmet3.inmet.gov.br/autocomplete/' + encodeURIComponent(nome);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const lista = await res.json();
  if (!lista.length) throw new Error(`Nenhum resultado para "${cidade}"`);

  // Tenta o melhor match: item que contenha a cidade e termine com a UF (ex: "Uruguaiana-RS")
  const achou =
    lista.find(
      (x) =>
        semAcento(x.value).toLowerCase().includes(nome.toLowerCase()) &&
        (!uf || semAcento(x.value).toLowerCase().endsWith('-' + uf))
    ) || lista[0];
  return achou;
}

(async () => {
  const cidades = process.argv.slice(2);
  if (!cidades.length) {
    console.error('Uso: node salvar_geocodes.js "Uruguaiana RS" "Santiago RS" "Porto Xavier RS"');
    process.exit(1);
  }

  let banco = {};
  if (fs.existsSync(ARQUIVO)) banco = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));

  for (const cidade of cidades) {
    const item = await buscar(cidade);
    const chave = cidade.toLowerCase();
    banco[chave] = {
      geocode: item.geocode,
      nome: item.value,
      custom: item.custom,
      latitude: item.latitude,
      longitude: item.longitude,
    };
    console.log(`${cidade} -> geocode ${item.geocode} (${item.value})`);
  }

  fs.writeFileSync(ARQUIVO, JSON.stringify(banco, null, 2) + '\n');
  console.log('Salvo em:', ARQUIVO);
})();
