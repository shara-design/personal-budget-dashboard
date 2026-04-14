const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = 'shara-design';
const REPO_NAME = 'personal-budget-dashboard';
const DATA_FILE = 'data.json';
const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID;

const bot = new TelegramBot(TOKEN, { polling: true });

const CATEGORIES = {
  'hogar': 'Hogar',
  'casa': 'Hogar',
  'comida': 'Comida',
  'mercado': 'Comida',
  'restaurante': 'Comida',
  'transporte': 'Transporte',
  'uber': 'Transporte',
  'taxi': 'Transporte',
  'pasajes': 'Transporte',
  'educacion': 'Educación',
  'educación': 'Educación',
  'universidad': 'Educación',
  'entretenimiento': 'Entretenimiento',
  'salida': 'Entretenimiento',
  'cine': 'Entretenimiento',
  'viaje': 'Entretenimiento',
  'viajes': 'Entretenimiento',
  'suscripcion': 'Entretenimiento',
  'suscripciones': 'Entretenimiento',
  'credito': 'Créditos/Deudas',
  'creditos': 'Créditos/Deudas',
  'deuda': 'Créditos/Deudas',
  'tarjeta': 'Créditos/Deudas',
  'familia': 'Familia',
};

const CATEGORY_TYPES = {
  'Hogar': 'E',
  'Comida': 'E',
  'Transporte': 'E',
  'Educación': 'E',
  'Créditos/Deudas': 'E',
  'Entretenimiento': 'NE',
  'Familia': 'NE',
};

// --- GitHub API helpers ---

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO_OWNER}/${REPO_NAME}/${path}`,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'budget-bot',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getData() {
  const res = await githubRequest('GET', `contents/${DATA_FILE}`);
  if (res.status !== 200) throw new Error('No se pudo leer data.json');
  const content = Buffer.from(res.data.content, 'base64').toString('utf8');
  return { data: JSON.parse(content), sha: res.data.sha };
}

async function saveDataToGithub(data, sha, message) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const res = await githubRequest('PUT', `contents/${DATA_FILE}`, {
    message,
    content,
    sha,
  });
  if (res.status !== 200) throw new Error('No se pudo guardar data.json');
  return res;
}

function getCurrentMonth() {
  return new Date().getMonth(); // 0-indexed
}

function formatMoney(n) {
  return '$ ' + Number(n).toLocaleString('es-CO');
}

// --- Bot commands ---

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `Hola! Soy tu bot de presupuesto.\n\nComandos:\n` +
    `/gasto 50000 comida almuerzo\n` +
    `/ingreso 6300000 salario\n` +
    `/ahorro 100000 emergencia\n` +
    `/resumen - ver resumen del mes\n` +
    `/gastos - ver lista de gastos\n` +
    `/borrar nombre del gasto\n` +
    `/help - ver esta ayuda`
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `Comandos disponibles:\n\n` +
    `/gasto [monto] [categoría] [descripción]\n` +
    `  Ej: /gasto 50000 comida almuerzo\n\n` +
    `/ingreso [monto] [tipo]\n` +
    `  Tipos: salario, comisiones, otros\n` +
    `  Ej: /ingreso 6300000 salario\n\n` +
    `/ahorro [monto] [tipo]\n` +
    `  Tipos: viajes, general, emergencia, inversiones\n` +
    `  Ej: /ahorro 100000 emergencia\n\n` +
    `/resumen - resumen del mes actual\n` +
    `/gastos - lista de gastos del mes\n` +
    `/borrar [nombre] - eliminar un gasto\n\n` +
    `Categorías: hogar, comida, transporte, educacion, entretenimiento, credito, familia`
  );
});

bot.onText(/\/gasto (.+)/, async (msg, match) => {
  if (ALLOWED_USER_ID && String(msg.from.id) !== ALLOWED_USER_ID) return;

  const parts = match[1].trim().split(/\s+/);
  if (parts.length < 2) {
    return bot.sendMessage(msg.chat.id, 'Formato: /gasto [monto] [categoría] [descripción]\nEj: /gasto 50000 comida almuerzo');
  }

  const amount = parseInt(parts[0].replace(/[.,]/g, ''));
  if (isNaN(amount) || amount <= 0) {
    return bot.sendMessage(msg.chat.id, 'El monto debe ser un número positivo');
  }

  const catKey = parts[1].toLowerCase();
  const category = CATEGORIES[catKey];
  if (!category) {
    return bot.sendMessage(msg.chat.id,
      `Categoría "${parts[1]}" no reconocida.\n\nCategorías válidas: ${Object.keys(CATEGORIES).join(', ')}`
    );
  }

  const description = parts.slice(2).join(' ') || category;
  const month = getCurrentMonth();

  try {
    const { data, sha } = await getData();
    if (!data.months[month]) {
      data.months[month] = {
        income: { Salario: 0, Comisiones: 0, Otros: 0 },
        savings: { Viajes: 0, General: 0, Emergencia: 0, Inversiones: 0 },
        expenses: []
      };
    }

    data.months[month].expenses.push({
      name: description.charAt(0).toUpperCase() + description.slice(1),
      category,
      type: CATEGORY_TYPES[category] || 'NE',
      freq: 'Mensual',
      amount,
    });

    await saveDataToGithub(data, sha, `Gasto: ${formatMoney(amount)} - ${description}`);

    const totalExpenses = data.months[month].expenses.reduce((s, e) => s + e.amount, 0);
    bot.sendMessage(msg.chat.id,
      `Gasto registrado!\n\n` +
      `${description}: ${formatMoney(amount)}\n` +
      `Categoría: ${category}\n` +
      `Total gastos del mes: ${formatMoney(totalExpenses)}`
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, 'Error al guardar: ' + err.message);
  }
});

bot.onText(/\/ingreso (.+)/, async (msg, match) => {
  if (ALLOWED_USER_ID && String(msg.from.id) !== ALLOWED_USER_ID) return;

  const parts = match[1].trim().split(/\s+/);
  const amount = parseInt(parts[0].replace(/[.,]/g, ''));
  if (isNaN(amount) || amount <= 0) {
    return bot.sendMessage(msg.chat.id, 'Formato: /ingreso [monto] [tipo]\nTipos: salario, comisiones, otros');
  }

  const typeMap = {
    'salario': 'Salario',
    'comisiones': 'Comisiones',
    'comision': 'Comisiones',
    'otros': 'Otros',
    'otro': 'Otros',
  };

  const typeKey = (parts[1] || 'salario').toLowerCase();
  const incomeType = typeMap[typeKey];
  if (!incomeType) {
    return bot.sendMessage(msg.chat.id, 'Tipo no válido. Usa: salario, comisiones, otros');
  }

  const month = getCurrentMonth();

  try {
    const { data, sha } = await getData();
    if (!data.months[month]) {
      data.months[month] = {
        income: { Salario: 0, Comisiones: 0, Otros: 0 },
        savings: { Viajes: 0, General: 0, Emergencia: 0, Inversiones: 0 },
        expenses: []
      };
    }

    data.months[month].income[incomeType] = amount;
    await saveDataToGithub(data, sha, `Ingreso: ${formatMoney(amount)} - ${incomeType}`);

    const totalIncome = Object.values(data.months[month].income).reduce((s, v) => s + v, 0);
    bot.sendMessage(msg.chat.id,
      `Ingreso actualizado!\n\n` +
      `${incomeType}: ${formatMoney(amount)}\n` +
      `Total ingresos del mes: ${formatMoney(totalIncome)}`
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, 'Error al guardar: ' + err.message);
  }
});

bot.onText(/\/ahorro (.+)/, async (msg, match) => {
  if (ALLOWED_USER_ID && String(msg.from.id) !== ALLOWED_USER_ID) return;

  const parts = match[1].trim().split(/\s+/);
  const amount = parseInt(parts[0].replace(/[.,]/g, ''));
  if (isNaN(amount) || amount <= 0) {
    return bot.sendMessage(msg.chat.id, 'Formato: /ahorro [monto] [tipo]\nTipos: viajes, general, emergencia, inversiones');
  }

  const typeMap = {
    'viajes': 'Viajes',
    'viaje': 'Viajes',
    'general': 'General',
    'emergencia': 'Emergencia',
    'inversiones': 'Inversiones',
    'inversion': 'Inversiones',
  };

  const typeKey = (parts[1] || 'general').toLowerCase();
  const savingsType = typeMap[typeKey];
  if (!savingsType) {
    return bot.sendMessage(msg.chat.id, 'Tipo no válido. Usa: viajes, general, emergencia, inversiones');
  }

  const month = getCurrentMonth();

  try {
    const { data, sha } = await getData();
    if (!data.months[month]) {
      data.months[month] = {
        income: { Salario: 0, Comisiones: 0, Otros: 0 },
        savings: { Viajes: 0, General: 0, Emergencia: 0, Inversiones: 0 },
        expenses: []
      };
    }

    data.months[month].savings[savingsType] = amount;
    await saveDataToGithub(data, sha, `Ahorro: ${formatMoney(amount)} - ${savingsType}`);

    const totalSavings = Object.values(data.months[month].savings).reduce((s, v) => s + v, 0);
    bot.sendMessage(msg.chat.id,
      `Ahorro actualizado!\n\n` +
      `${savingsType}: ${formatMoney(amount)}\n` +
      `Total ahorros del mes: ${formatMoney(totalSavings)}`
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, 'Error al guardar: ' + err.message);
  }
});

bot.onText(/\/resumen/, async (msg) => {
  if (ALLOWED_USER_ID && String(msg.from.id) !== ALLOWED_USER_ID) return;

  const month = getCurrentMonth();
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  try {
    const { data } = await getData();
    const m = data.months[month] || { income: {}, savings: {}, expenses: [] };

    const totalIncome = Object.values(m.income || {}).reduce((s, v) => s + v, 0);
    const totalExpenses = (m.expenses || []).reduce((s, e) => s + e.amount, 0);
    const totalSavings = Object.values(m.savings || {}).reduce((s, v) => s + v, 0);
    const available = totalIncome - totalSavings - totalExpenses;

    const essentialExpenses = (m.expenses || []).filter(e => e.type === 'E').reduce((s, e) => s + e.amount, 0);
    const nonEssentialExpenses = (m.expenses || []).filter(e => e.type === 'NE').reduce((s, e) => s + e.amount, 0);

    bot.sendMessage(msg.chat.id,
      `Resumen ${monthNames[month]} 2026\n\n` +
      `Ingresos: ${formatMoney(totalIncome)}\n` +
      `Ahorros: ${formatMoney(totalSavings)}\n` +
      `Gastos totales: ${formatMoney(totalExpenses)}\n` +
      `  - Esenciales: ${formatMoney(essentialExpenses)}\n` +
      `  - No esenciales: ${formatMoney(nonEssentialExpenses)}\n` +
      `\nDisponible: ${formatMoney(available)}` +
      (available < 0 ? '\n\nGastas más de lo que ganas!' : '\nVas bien!')
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, 'Error: ' + err.message);
  }
});

bot.onText(/\/gastos/, async (msg) => {
  if (ALLOWED_USER_ID && String(msg.from.id) !== ALLOWED_USER_ID) return;

  const month = getCurrentMonth();
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  try {
    const { data } = await getData();
    const m = data.months[month] || { expenses: [] };
    const expenses = (m.expenses || []).filter(e => e.amount > 0);

    if (expenses.length === 0) {
      return bot.sendMessage(msg.chat.id, `No hay gastos registrados en ${monthNames[month]}`);
    }

    let text = `Gastos ${monthNames[month]} 2026:\n\n`;
    expenses.forEach(e => {
      text += `${e.type === 'E' ? '🟢' : '🟡'} ${e.name}: ${formatMoney(e.amount)} (${e.category})\n`;
    });

    const total = expenses.reduce((s, e) => s + e.amount, 0);
    text += `\nTotal: ${formatMoney(total)}`;

    bot.sendMessage(msg.chat.id, text);
  } catch (err) {
    bot.sendMessage(msg.chat.id, 'Error: ' + err.message);
  }
});

bot.onText(/\/borrar (.+)/, async (msg, match) => {
  if (ALLOWED_USER_ID && String(msg.from.id) !== ALLOWED_USER_ID) return;

  const name = match[1].trim().toLowerCase();
  const month = getCurrentMonth();

  try {
    const { data, sha } = await getData();
    const m = data.months[month];
    if (!m || !m.expenses) {
      return bot.sendMessage(msg.chat.id, 'No hay gastos este mes');
    }

    const idx = m.expenses.findIndex(e => e.name.toLowerCase().includes(name));
    if (idx === -1) {
      return bot.sendMessage(msg.chat.id, `No encontré un gasto con "${match[1].trim()}"`);
    }

    const removed = m.expenses.splice(idx, 1)[0];
    await saveDataToGithub(data, sha, `Borrar gasto: ${removed.name}`);

    bot.sendMessage(msg.chat.id, `Gasto eliminado: ${removed.name} (${formatMoney(removed.amount)})`);
  } catch (err) {
    bot.sendMessage(msg.chat.id, 'Error: ' + err.message);
  }
});

console.log('Budget bot running...');
