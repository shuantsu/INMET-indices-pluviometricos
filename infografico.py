#!/usr/bin/env python3
"""
Infográfico INMET com Plotly em Horário de Brasília (UTC-3).

Lê os CSVs gerados por buscar_geocode.js (Highcharts getCSV):
  "Horas (UTC)";"Precipitação";"Umidade";"Temperatura";"Sensação Térmica"

Converte Horas (UTC) -> Horas (BRT) = (UTC - 3) % 24.

Gera saida.html com:
  - índice lateral com TODOS os *.csv da pasta (mais recente primeiro),
  - gráfico Plotly do CSV selecionado (temperatura/sensação/umidade + chuva),
  - abertura automática em janela WebView2 (Edge/Chromium).

Uso:
  python infografico.py [csv_inicial] [--html saida.html] [--no-webview]
"""

import argparse
import glob
import html as htmlmod
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAIDA_PADRAO = os.path.join(BASE_DIR, "saida.html")
BRT = timezone(timedelta(hours=-3))


def listar_csvs():
    arquivos = sorted(
        set(glob.glob(os.path.join(BASE_DIR, "*.csv"))),
        key=os.path.getmtime,
        reverse=True,  # mais recente primeiro
    )
    return arquivos


def achar_csv(padrao=None):
    if padrao:
        p = padrao if os.path.isabs(padrao) else os.path.join(BASE_DIR, padrao)
        if os.path.isfile(p):
            return p
        raise FileNotFoundError(f"CSV não encontrado: {padrao}")
    todos = listar_csvs()
    if not todos:
        raise FileNotFoundError("Nenhum CSV encontrado na pasta do script.")
    return todos[0]


def cidade_do_arquivo(caminho):
    base = os.path.splitext(os.path.basename(caminho))[0]
    partes = base.rsplit("-", 1)
    if len(partes) == 2 and partes[1].isdigit():
        base = partes[0]
    return base.replace("-", " ").title()


def epoch_do_arquivo(caminho):
    base = os.path.splitext(os.path.basename(caminho))[0]
    partes = base.rsplit("-", 1)
    if len(partes) == 2 and partes[1].isdigit():
        try:
            return int(partes[1])
        except ValueError:
            return None
    return None


def data_coleta_brt(caminho):
    epoch = epoch_do_arquivo(caminho)
    if epoch:
        dt = datetime.fromtimestamp(epoch, tz=BRT)
    else:
        dt = datetime.fromtimestamp(os.path.getmtime(caminho), tz=BRT)
    return dt.strftime("%d/%m/%Y %H:%M BRT")


def ler_csv(caminho):
    # utf-8-sig remove o BOM '\ufeff' que o buscar_geocode.js adiciona
    df = pd.read_csv(
        caminho, sep=";", encoding="utf-8-sig",
        quotechar='"', dtype=str, keep_default_na=False,
    )
    colmap = {}
    for c in df.columns:
        cl = c.strip().lower()
        if "hora" in cl:
            colmap[c] = "hora_utc"
        elif "precipita" in cl:
            colmap[c] = "precipitacao"
        elif "umidade" in cl:
            colmap[c] = "umidade"
        elif "sensa" in cl:
            colmap[c] = "sensacao"
        elif "temperatura" in cl:
            colmap[c] = "temperatura"
    df = df.rename(columns=colmap)

    def num(s):
        s = (s or "").strip().replace(",", ".")
        if s == "" or s == "-":
            return None
        try:
            return float(s)
        except ValueError:
            return None

    horas = []
    for v in df["hora_utc"].astype(str):
        v = v.strip().strip('" ')
        horas.append(int(v) if v.isdigit() else None)
    df["hora_utc"] = horas
    df = df.dropna(subset=["hora_utc"])
    df["hora_utc"] = df["hora_utc"].astype(int)
    for col in ("precipitacao", "umidade", "temperatura", "sensacao"):
        df[col] = df[col].apply(num) if col in df.columns else None

    # UTC -> BRT (UTC-3), mantendo ordem temporal de UTC:
    # eixo BRT "dá a volta": 21,22,23,0,1,...
    df["hora_brt"] = (df["hora_utc"] - 3) % 24
    df = df.sort_values("hora_utc").reset_index(drop=True)
    df["rotulo_brt"] = df["hora_brt"].apply(lambda h: f"{h:02d}h")
    return df


def dataset_para_js(caminho):
    df = ler_csv(caminho)
    chuva = [x for x in df["precipitacao"].tolist()]
    total = round(float(pd.Series(chuva).sum(skipna=True)), 1)
    tmax = pd.Series(df["temperatura"].tolist()).max()
    tmin = pd.Series(df["temperatura"].tolist()).min()
    umax = pd.Series(df["umidade"].tolist()).max()
    return {
        "id": os.path.basename(caminho),
        "arquivo": os.path.basename(caminho),
        "cidade": cidade_do_arquivo(caminho),
        "coletado_em": data_coleta_brt(caminho),
        "epoch": epoch_do_arquivo(caminho),
        "labels": df["rotulo_brt"].tolist(),
        "hora_utc": df["hora_utc"].tolist(),
        "hora_brt": df["hora_brt"].tolist(),
        "temperatura": df["temperatura"].tolist(),
        "sensacao": df["sensacao"].tolist(),
        "umidade": df["umidade"].tolist(),
        "precipitacao": df["precipitacao"].tolist(),
        "kpis": {
            "chuva_total": None if pd.isna(total) else total,
            "tmax": None if pd.isna(tmax) else round(float(tmax), 1),
            "tmin": None if pd.isna(tmin) else round(float(tmin), 1),
            "umax": None if pd.isna(umax) else round(float(umax)),
        },
    }


def gerar_saida_html(datasets, inicial_id, destino):
    items = []
    for d in datasets:
        sel = "active" if d["id"] == inicial_id else ""
        items.append(
            f'<button class="csv-item {sel}" data-id="{htmlmod.escape(d["id"])}">'
            f'<span class="csv-cidade">{htmlmod.escape(d["cidade"])}</span>'
            f'<span class="csv-meta">{htmlmod.escape(d["arquivo"])}<br>{htmlmod.escape(d["coletado_em"])}</span>'
            f"</button>"
        )
    indice_html = "\n".join(items) if items else "<p>Nenhum CSV.</p>"
    dados_json = json.dumps({d["id"]: d for d in datasets}, ensure_ascii=False)

    pagina = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>INMET — Índice pluviométrico (BRT)</title>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Segoe UI, Arial, sans-serif; display: flex; height: 100vh; }
  aside { width: 300px; min-width: 260px; border-right: 1px solid #ddd; padding: 12px; overflow-y: auto; background: #f7f7f7; }
  aside h2 { font-size: 16px; margin: 4px 0 8px; }
  aside .hint { font-size: 12px; color: #555; margin-bottom: 10px; }
  .csv-item { display: block; width: 100%; text-align: left; margin-bottom: 8px; padding: 8px 10px;
    border: 1px solid #ddd; border-radius: 8px; background: #fff; cursor: pointer; }
  .csv-item:hover { border-color: #888; }
  .csv-item.active { border-color: #1f77b4; background: #e8f1fa; }
  .csv-cidade { display: block; font-weight: 600; }
  .csv-meta { display: block; font-size: 11px; color: #555; margin-top: 2px; }
  main { flex: 1; padding: 12px 16px; overflow-y: auto; }
  #kpis { display: flex; gap: 12px; flex-wrap: wrap; margin: 8px 0 4px; }
  .kpi { background: #eef4fb; border: 1px solid #d4e2f2; border-radius: 8px; padding: 8px 14px; font-size: 14px; }
  #graf { width: 100%; height: 62vh; min-height: 380px; }
  #graf2 { width: 100%; height: 30vh; min-height: 200px; }
  header small { color: #555; }
</style>
</head>
<body>
<aside>
  <h2>Índice de CSVs</h2>
  <div class="hint">Todos os <b>*.csv</b> da pasta. Clique para abrir o infográfico (hora de Brasília, UTC-3).</div>
  <div id="indice">
__INDICE__
  </div>
</aside>
<main>
  <header>
    <h1 id="titulo" style="margin:0"></h1>
    <small id="subtitulo"></small>
    <div id="kpis"></div>
  </header>
  <div id="graf"></div>
  <div id="graf2"></div>
</main>
<script>
const DATASETS = __DADOS__;
let atual = __INICIAL__;

function fmt(v, dec=1, suf="") {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Number(v).toFixed(dec) + suf;
}

function render(id) {
  atual = id;
  const d = DATASETS[id];
  if (!d) return;
  document.querySelectorAll(".csv-item").forEach(b =>
    b.classList.toggle("active", b.dataset.id === id));
  document.getElementById("titulo").textContent = d.cidade + " — Condições Diárias INMET";
  document.getElementById("subtitulo").textContent =
    d.arquivo + " • coletado em " + d.coletado_em + " • eixo em Horário de Brasília (UTC-3)";
  document.getElementById("kpis").innerHTML =
    `<div class="kpi">Chuva total: <b>${fmt(d.kpis.chuva_total)} mm</b></div>` +
    `<div class="kpi">Tmáx: <b>${fmt(d.kpis.tmax)} °C</b></div>` +
    `<div class="kpi">Tmín: <b>${fmt(d.kpis.tmin)} °C</b></div>` +
    `<div class="kpi">Umid. máx: <b>${fmt(d.kpis.umax, 0, "%")}</b></div>`;

  Plotly.newPlot("graf", [
    { x: d.labels, y: d.temperatura, name: "Temperatura (°C)", type: "scatter", mode: "lines+markers" },
    { x: d.labels, y: d.sensacao, name: "Sensação (°C)", type: "scatter", mode: "lines+markers" },
    { x: d.labels, y: d.umidade, name: "Umidade (%)", type: "scatter", mode: "lines",
      line: { dash: "dot" }, yaxis: "y2", opacity: 0.7 },
  ], {
    title: "Temperatura / Sensação / Umidade",
    hovermode: "x unified", template: "plotly_white",
    margin: { t: 40, b: 40 },
    yaxis: { title: "°C" }, yaxis2: { title: "Umidade (%)", overlaying: "y", side: "right" },
    xaxis: { title: "Hora (BRT / UTC-3)" },
    legend: { orientation: "h" },
  }, { responsive: true });

  Plotly.newPlot("graf2", [
    { x: d.labels, y: d.precipitacao, name: "Precipitação (mm)", type: "bar", opacity: 0.8 },
  ], {
    title: "Precipitação (mm)", template: "plotly_white",
    margin: { t: 40, b: 40 },
    yaxis: { title: "mm", rangemode: "tozero" },
    xaxis: { title: "Hora (BRT / UTC-3)" },
  }, { responsive: true });
}

document.getElementById("indice").addEventListener("click", e => {
  const b = e.target.closest(".csv-item");
  if (b) render(b.dataset.id);
});
render(atual);
</script>
</body>
</html>
"""
    pagina = pagina.replace("__INDICE__", indice_html)
    pagina = pagina.replace("__DADOS__", dados_json)
    pagina = pagina.replace("__INICIAL__", json.dumps(inicial_id, ensure_ascii=False))
    with open(destino, "w", encoding="utf-8") as f:
        f.write(pagina)
    return destino


def abrir_webview2(html_path, titulo="INMET (BRT)"):
    """Abre o HTML em janela (WebView2/Edge no Windows, gtk/qt no Linux).

    Exige `pip install pywebview`. Em servidor headless (sem DISPLAY),
    use `--no-webview` em vez de chamar esta função.
    """
    try:
        import webview
    except ImportError:
        raise RuntimeError("pywebview não instalado. Rode: python -m pip install pywebview")
    url = "file:///" + os.path.abspath(html_path).replace("\\", "/")
    win = webview.create_window(titulo, url, width=1200, height=800)
    if sys.platform == "win32":
        # gui="edgechromium" força WebView2 no Windows; cai para auto se indisponível
        try:
            webview.start(gui="edgechromium")
        except Exception:
            webview.start()
    else:
        webview.start()  # Linux/macOS: backend automático (gtk/qt/cocoa)
    return win


def sem_display():
    """True em servidor headless Linux (SSH sem X/Wayland)."""
    return sys.platform.startswith("linux") and not os.environ.get("DISPLAY")


def main():
    ap = argparse.ArgumentParser(description="Infográfico INMET (BRT) -> saida.html + WebView2.")
    ap.add_argument("csv", nargs="?", default=None, help="CSV inicial (padrão: mais recente).")
    ap.add_argument("--html", default=SAIDA_PADRAO, help="HTML de saída (padrão: saida.html).")
    ap.add_argument("--no-webview", action="store_true", help="Só gerar o HTML, sem abrir WebView2.")
    args = ap.parse_args()

    todos = listar_csvs()
    if not todos:
        raise FileNotFoundError("Nenhum CSV encontrado na pasta do script.")
    inicial = achar_csv(args.csv)
    datasets = [dataset_para_js(c) for c in todos]
    inicial_id = os.path.basename(inicial)

    destino = gerar_saida_html(datasets, inicial_id, args.html)
    print(f"CSVs indexados ({len(datasets)}):")
    for d in datasets:
        print(f"  - {d['arquivo']} ({d['cidade']}, {d['coletado_em']})")
    print(f"HTML salvo em: {destino}")

    if args.no_webview or sem_display():
        if sem_display() and not args.no_webview:
            print("Sem DISPLAY (headless Linux): HTML gerado sem abrir janela.")
            print("Sirva com: python3 -m http.server 8000  ou baixe o HTML via scp.")
        return

    print("Abrindo em WebView2...")
    abrir_webview2(destino)


if __name__ == "__main__":
    sys.exit(main())
