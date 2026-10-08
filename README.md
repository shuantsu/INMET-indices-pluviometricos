# Índices Pluviométricos (INMET)

Baixa os dados de **Condições Diárias** do portal do INMET por cidade e gera um **infográfico HTML interativo** (Plotly) em Horário de Brasília (BRT, UTC-3).

Fluxo:

```
INMET (portal.inmet.gov.br)
  → buscar_geocode.js (Node + Playwright) → <cidade>-<timestamp>.csv
  → infografico.py (Python + pandas + Plotly) → saida.html
```

## Estrutura do projeto

| Arquivo | O que faz |
|---|---|
| `buscar_geocode.js` | CLI para baixar o CSV do INMET por cidade (interativo ou direto). Usa Playwright + extração via `Highcharts.getCSV()`. |
| `salvar_geocodes.js` | Resolve geocodes (IBGE) via API de autocomplete do INMET e salva em `geocodes.json`. |
| `infografico.py` | Lê todos os `*.csv` da pasta, converte hora UTC → BRT e gera `saida.html` com gráficos + índice lateral. Abre em janela WebView2. |
| `geocodes.json.example` | Modelo de `geocodes.json`. Copie para começar. |
| `geocodes.json` | Banco local de cidades (ignorado pelo git, ver `.gitignore`). |
| `*.csv` | CSVs baixados do INMET (ignorados pelo git). |
| `saida.html` / `*.html` | Infográficos gerados (ignorados pelo git). |

## Pré-requisitos

- **Node.js 18+** (o código usa `fetch` nativo). Confira com:
  ```bash
  node --version
  npm --version
  ```
- **Python 3.10+**. Confira com:
  ```bash
  python --version
  ```
- **Git** (opcional, só para clonar).

## 1. Setup — Node

Na raiz do projeto:

```bash
npm install
```

Isso instala a única dependência Node declarada em `package.json`:

- `playwright` (`^1.64.0`)

Em seguida, instale o navegador do Playwright:

```bash
npx playwright install chromium
```

> Nota: o caminho do Chromium pode ser forçado via variável de ambiente `PLAYWRIGHT_CHROMIUM_EXE` (útil no Windows com Device Guard, onde o build 1248 dá `spawn UNKNOWN`). Se não definida, o Playwright usa o Chromium do cache padrão. O script já roda em modo headless com `--no-sandbox`, pronto para servidor Linux.

## 1b. Setup — AlmaLinux 9 (servidor headless, SSH)

```bash
# Ferramentas base
sudo dnf install -y curl git python3 python3-pip

# Node.js 20 via NodeSource (o AppStream do EL9 não tem Node 18+)
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
node --version  # precisa ser >= 18 (fetch nativo)

# Projeto
cd /caminho/para/indices_pluvimetricos
npm install

# Chromium do Playwright + dependências do sistema
sudo npx playwright install --with-deps chromium
# Alternativa sem sudo no install: 
#   npx playwright install chromium
#   sudo dnf install -y nss atk at-spi2-atk cups-libs libdrm libXcomposite \
#     libXdamage libXrandr mesa-libgbm pango alsa-lib

# Cidades
cp geocodes.json.example geocodes.json
node salvar_geocodes.js "Porto Xavier RS" "Sao Borja RS"

# Baixar CSV (headless, sem interface)
node buscar_geocode.js "porto xavier"

# Infográfico (sem janela — não há WebView2/Edge nem DISPLAY no servidor)
python3 -m pip install --user pandas
python3 infografico.py --no-webview

# Ver o resultado no seu PC: sirva via HTTP e/ou baixe com scp
python3 -m http.server 8000
# no seu PC: scp usuario@servidor:/caminho/para/saida.html .
```

Notas do servidor headless:

- O `infografico.py` detecta ausência de `DISPLAY` no Linux e **não tenta abrir janela** — só gera o HTML.
- `pywebview` **não é necessário** no servidor. Só instale se a máquina tiver GUI.
- Se rodar como root, o `--no-sandbox` já está incluído no `buscar_geocode.js`.

## 2. Setup — arquivo de cidades

O `geocodes.json` é local e **não vai para o git** (está no `.gitignore`). Crie a partir do exemplo:

Windows (cmd/PowerShell):

```bash
copy geocodes.json.example geocodes.json
```

Linux/macOS:

```bash
cp geocodes.json.example geocodes.json
```

O formato é:

```json
{
  "porto xavier rs": {
    "geocode": 4315107,
    "nome": "Porto Xavier-RS",
    "custom": "RS-Porto Xavier",
    "latitude": "-27.93...",
    "longitude": "-55.14..."
  }
}
```

### Adicionar novas cidades

Opção A — via `salvar_geocodes.js` (lote, sem menu):

```bash
node salvar_geocodes.js "Uruguaiana RS" "Santiago RS" "Porto Xavier RS"
```

A UF no final (`RS`) é opcional, serve só para desambiguar. A API consultada é `https://apiprevmet3.inmet.gov.br/autocomplete/<nome>`.

Opção B — via `buscar_geocode.js` (interativo, opção `N` → digita a cidade → escolhe o número → ela é salva no `geocodes.json` e volta ao menu).

## 3. Setup — Python

O `infografico.py` precisa de:

- `pandas` (obrigatório — leitura dos CSVs)
- `pywebview` (opcional — só para abrir a janela WebView2/Edge; sem ele use `--no-webview`)

Instale com:

```bash
python -m pip install pandas pywebview
```

## 4. Como rodar — baixar o CSV do INMET

Modo interativo (menu):

```bash
node buscar_geocode.js
```

Você verá algo como:

```
=== INMET - CSV por cidade ===
1) Porto Xavier-RS (geocode 4315107)
2) São Borja-RS (geocode 4318002)
N) Buscar nova cidade
0) Sair
Escolha:
```

- Digite o **número** para baixar o CSV daquela cidade.
- Digite **`N`** para buscar e cadastrar uma cidade nova.
- Digite **`0`** para sair.

Modo direto (pula o menu):

```bash
node buscar_geocode.js "porto xavier"
node buscar_geocode.js "sao borja rs"
```

O que acontece: abre o portal do INMET já posicionado na cidade (via `localStorage`), espera o texto `Condições Diárias`, extrai o CSV do gráfico Highcharts e salva como:

```
<cidade>-<timestamp>.csv
```

Exemplos reais nesta pasta: `porto-xavier-1791497574.csv`, `sao-borja-1791483282.csv`.

O CSV tem o formato (separador `;`, com BOM):

```
"Horas (UTC)";"Precipitação";"Umidade";"Temperatura";"Sensação Térmica"
```

## 5. Como rodar — gerar o infográfico

Com pelo menos um `*.csv` na pasta:

```bash
python infografico.py
```

Isso:

1. Lista todos os `*.csv` da pasta (mais recente primeiro).
2. Gera `saida.html` com índice lateral + gráficos Plotly (temperatura/sensação/umidade + precipitação) + KPIs (chuva total, Tmáx, Tmín, umidade máx).
3. Abre automaticamente em janela WebView2 (Edge/Chromium).

Variações:

```bash
# Escolher o CSV inicial (padrão: o mais recente)
python infografico.py sao-borja-1791483282.csv

# Escolher o HTML de saída
python infografico.py --html meu-relatorio.html

# Só gerar o HTML, sem abrir janela (útil sem pywebview / em servidor)
python infografico.py --no-webview
```

Depois abra o `saida.html` no navegador. O eixo de horas já está convertido: `Hora BRT = (Hora UTC - 3) % 24`.

## Troubleshooting

| Erro | Causa / solução |
|---|---|
| `spawn UNKNOWN` com Chromium build 1248 (Device Guard, Windows) | Force o build que funciona via env: `set PLAYWRIGHT_CHROMIUM_EXE=C:\...\chromium-1243\chrome-win64\chrome.exe` (cmd) ou `$env:PLAYWRIGHT_CHROMIUM_EXE="..."` (PowerShell). No Linux deixe sem a variável. |
| `page.goto: Timeout exceeded` no portal | O portal do INMET é lento; o script usa 60s de timeout. Só rode de novo. Se persistir, teste `node -e "fetch('https://portal.inmet.gov.br/').then(r=>console.log(r.status))"` — se falhar, é rede/portal fora do ar. Para ver o que acontece: `PLAYWRIGHT_HEADED=1 node buscar_geocode.js "porto xavier"` (Windows, com janela). |
| `HTTP 4xx/5xx no autocomplete` / `Nenhum resultado` | API do INMET fora do ar ou nome sem acento/UF ambíguo. Tente `node salvar_geocodes.js "Sao Borja RS"`. |
| `Nenhum CSV encontrado na pasta` (Python) | Rode primeiro o `buscar_geocode.js` para gerar um CSV, ou passe o caminho: `python infografico.py meu.csv`. |
| `pywebview não instalado` | Rode `python -m pip install pywebview` ou use `--no-webview`. |
| Caracteres estranhos no CSV | O script adiciona BOM de propósito; o `infografico.py` lê com `encoding="utf-8-sig"`. Não remova. |

## .gitignore

Estão ignorados e **não são commitados**:

- `node_modules/`
- `geocodes.json` (seu banco local — use o `.example` como base)
- `*.csv` (dados baixados)
- `*.html` (infográficos gerados)
- `*.png`
