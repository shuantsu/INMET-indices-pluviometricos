// db.js - acesso MySQL (último valor válido do CSV do INMET).
// Uso:
//   cp .env.example .env  (preencha MYSQL_*)
//   node -e "require('./db').testarConexao().then(()=>process.exit(0))"
// Tabela (criada via ensureTable()):
//   leituras_inmet(geocode, cidade, data_ref, hora_utc, hora_brt,
//     precipitacao, umidade, temperatura, sensacao, coletado_em,
//     UNIQUE KEY uq_leitura (geocode, data_ref, hora_utc))
// Regra: 1 linha por cidade/dia/hora. Downloads repetidos no mesmo dia
// para a mesma hora fazem UPDATE (coletado_em = último download), não INSERT.

const mysql = require('mysql2/promise');

const DDL = `
CREATE TABLE IF NOT EXISTS leituras_inmet (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  geocode INT NOT NULL,
  cidade VARCHAR(100) NOT NULL,
  data_ref DATE NOT NULL COMMENT 'dia da coleta (DATE(coletado_em))',
  hora_utc TINYINT NOT NULL,
  hora_brt TINYINT NOT NULL,
  precipitacao DECIMAL(6,2) NULL,
  umidade INT NULL,
  temperatura DECIMAL(5,2) NULL,
  sensacao DECIMAL(5,2) NULL,
  coletado_em DATETIME NOT NULL COMMENT 'download mais recente',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_leitura (geocode, data_ref, hora_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

let pool = null;

function mysqlConfigValido() {
  return Boolean(
    process.env.MYSQL_HOST &&
      process.env.MYSQL_USER &&
      process.env.MYSQL_DATABASE
  );
}

function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 5),
    dateStrings: false,
  });
  return pool;
}

async function closePool() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

function dataRefDe(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function ensureTable(conn) {
  await conn.query(DDL);
  // Migra tabelas criadas pela versão antiga (sem data_ref / unique errada).
  const [cols] = await conn.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leituras_inmet' AND COLUMN_NAME = 'data_ref'`
  );
  if (cols[0].n === 0) {
    await conn.query(`ALTER TABLE leituras_inmet ADD COLUMN data_ref DATE NULL AFTER cidade`);
    await conn.query(`UPDATE leituras_inmet SET data_ref = DATE(coletado_em) WHERE data_ref IS NULL`);
    await conn.query(`ALTER TABLE leituras_inmet MODIFY COLUMN data_ref DATE NOT NULL`);
  } else {
    await conn.query(`UPDATE leituras_inmet SET data_ref = DATE(coletado_em) WHERE data_ref IS NULL`);
  }
  const [stat] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leituras_inmet' AND INDEX_NAME = 'uq_leitura'
     ORDER BY SEQ_IN_INDEX`
  );
  const colsNaChave = stat.map((s) => s.COLUMN_NAME);
  const chaveAntiga =
    colsNaChave.length > 0 &&
    (colsNaChave.includes('coletado_em') || !colsNaChave.includes('data_ref'));
  if (chaveAntiga) {
    await conn.query(`ALTER TABLE leituras_inmet DROP INDEX uq_leitura`);
  }
  // Remove duplicados que a chave antiga permitiu: mantém o id maior
  // (download mais recente) por (geocode, data_ref, hora_utc).
  await conn.query(
    `DELETE t1 FROM leituras_inmet t1
     INNER JOIN leituras_inmet t2
       ON t1.id < t2.id
      AND t1.geocode = t2.geocode
      AND t1.data_ref = t2.data_ref
      AND t1.hora_utc = t2.hora_utc`
  );
  const [stat2] = await conn.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leituras_inmet' AND INDEX_NAME = 'uq_leitura'`
  );
  if (stat2[0].n === 0) {
    await conn.query(
      `ALTER TABLE leituras_inmet ADD UNIQUE KEY uq_leitura (geocode, data_ref, hora_utc)`
    );
  }
}

// Insert idempotente: mesma (geocode, data_ref, hora_utc) não duplica,
// só atualiza os valores + coletado_em (reprocessar o mesmo CSV é seguro).
async function inserirLeitura(entry, ultimo, coletadoEm) {
  if (!mysqlConfigValido()) {
    console.warn('MySQL não configurado (.env incompleto) — pulando insert.');
    return { skipped: true };
  }
  const p = getPool();
  const conn = await p.getConnection();
  try {
    await ensureTable(conn);
    const coletado = coletadoEm instanceof Date ? coletadoEm : new Date(coletadoEm);
    const dataRef = dataRefDe(coletado);
    const sql = `
INSERT INTO leituras_inmet
  (geocode, cidade, data_ref, hora_utc, hora_brt, precipitacao, umidade, temperatura, sensacao, coletado_em)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  cidade = VALUES(cidade),
  hora_brt = VALUES(hora_brt),
  precipitacao = VALUES(precipitacao),
  umidade = VALUES(umidade),
  temperatura = VALUES(temperatura),
  sensacao = VALUES(sensacao),
  coletado_em = VALUES(coletado_em);
`;
    const params = [
      entry.geocode,
      entry.nome,
      dataRef,
      ultimo.hora_utc,
      ultimo.hora_brt,
      ultimo.precipitacao,
      ultimo.umidade,
      ultimo.temperatura,
      ultimo.sensacao,
      coletado,
    ];
    const [res] = await conn.query(sql, params);
    console.log(
      `MySQL: ${entry.nome} ${dataRef} hora_utc=${ultimo.hora_utc} (afetadas=${res.affectedRows})`
    );
    return res;
  } finally {
    conn.release();
  }
}

async function testarConexao() {
  if (!mysqlConfigValido()) {
    throw new Error('MySQL não configurado — preencha MYSQL_HOST/USER/DATABASE no .env');
  }
  const p = getPool();
  const [rows] = await p.query('SELECT 1 AS ok');
  console.log('MySQL OK:', rows[0]);
}

module.exports = {
  DDL,
  dataRefDe,
  mysqlConfigValido,
  getPool,
  closePool,
  ensureTable,
  inserirLeitura,
  testarConexao,
};
