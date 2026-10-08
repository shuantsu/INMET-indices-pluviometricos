<?php

include('config.include.php');

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Consulta para buscar os registros
    $stmt = $pdo->query("SELECT id, geocode, cidade, data_ref, hora_utc, hora_brt, precipitacao, umidade, temperatura, sensacao, coletado_em, created_at FROM leituras_inmet ORDER BY id DESC");
    $registros = $stmt->fetchAll(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    die("Erro na conexão: " . $e->getMessage());
}
?>

<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitoramento Meteorológico</title>
    <style>
        :root {
            --bg-color: #f8fafc;
            --card-bg: #ffffff;
            --text-main: #1e293b;
            --text-muted: #64748b;
            --border-color: #e2e8f0;
            --hover-bg: #f1f5f9;
            --primary-color: #2563eb;
            --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            padding: 2rem;
            display: flex;
            justify-content: center;
        }

        .container {
            width: 100%;
            background: var(--card-bg);
            border-radius: 12px;
            box-shadow: var(--shadow);
            border: 1px solid var(--border-color);
            overflow: hidden;
        }

        .header {
            padding: 1.5rem;
            border-bottom: 1px solid var(--border-color);
        }

        .header h1 {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--text-main);
        }

        .table-wrapper {
            overflow-x: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            font-size: 0.875rem;
        }

        thead {
            background-color: #f1f5f9;
            color: var(--text-muted);
            text-transform: uppercase;
            font-size: 0.75rem;
            letter-spacing: 0.05em;
        }

        th, td {
            padding: 0.875rem 1rem;
            white-space: nowrap;
        }

        th {
            font-weight: 600;
            border-bottom: 1px solid var(--border-color);
        }

        tbody tr {
            border-bottom: 1px solid var(--border-color);
            transition: background-color 0.15s ease;
        }

        tbody tr:last-child {
            border-bottom: none;
        }

        tbody tr:hover {
            background-color: var(--hover-bg);
        }

        .numeric {
            font-variant-numeric: tabular-nums;
        }

        .badge {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 6px;
            background-color: #eff6ff;
            color: var(--primary-color);
            font-weight: 500;
            font-size: 0.8rem;
        }
    </style>
</head>
<body>

<div class="container">
    <div class="header">
        <h1>Registros de Clima</h1>
    </div>
    
    <div class="table-wrapper">
        <table>
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Geocode</th>
                    <th>Cidade</th>
                    <th>Data Ref</th>
                    <th>Hora UTC</th>
                    <th>Hora BRT</th>
                    <th>Precipitação</th>
                    <th>Umidade</th>
                    <th>Temperatura</th>
                    <th>Sensação</th>
                    <th>Coletado Em</th>
                    <th>Created At</th>
                </tr>
            </thead>
            <tbody>
                <?php if (!empty($registros)): ?>
                    <?php foreach ($registros as $row): ?>
                        <tr>
                            <td class="numeric"><?= htmlspecialchars($row['id']) ?></td>
                            <td class="numeric"><?= htmlspecialchars($row['geocode']) ?></td>
                            <td><span class="badge"><?= htmlspecialchars($row['cidade']) ?></span></td>
                            <td><?= htmlspecialchars($row['data_ref']) ?></td>
                            <td class="numeric"><?= htmlspecialchars($row['hora_utc']) ?></td>
                            <td class="numeric"><?= htmlspecialchars($row['hora_brt']) ?></td>
                            <td class="numeric"><?= number_format((float)$row['precipitacao'], 2, '.', '') ?> mm</td>
                            <td class="numeric"><?= htmlspecialchars($row['umidade']) ?>%</td>
                            <td class="numeric"><?= number_format((float)$row['temperatura'], 2, '.', '') ?> °C</td>
                            <td class="numeric"><?= number_format((float)$row['sensacao'], 2, '.', '') ?> °C</td>
                            <td class="numeric"><?= htmlspecialchars($row['coletado_em']) ?></td>
                            <td class="numeric"><?= htmlspecialchars($row['created_at']) ?></td>
                        </tr>
                    <?php endforeach; ?>
                <?php else: ?>
                    <tr>
                        <td colspan="12" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                            Nenhum registro encontrado.
                        </td>
                    </tr>
                <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>

</body>
</html>