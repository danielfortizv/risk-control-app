import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Calculator,
  Download,
  PiggyBank,
  RefreshCcw,
  Target,
  TrendingUp,
  Upload,
  Wallet,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const STORAGE_KEY = 'risk-control-app-v1';

const defaultSettings = {
  initialCapital: 5000,
  currentCapital: 5000,
  goal: 60000,
  goalDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1))
    .toISOString()
    .slice(0, 10),
  payoutRate: 0.89,
  maxBaseBetPct: 0.03,
  minBet: 1,
  dailyCycles: 3,
  weeklyDays: 7,
  withdrawalPct: 0.05,
  probabilities: [5 / 9, 6 / 9, 8 / 9],
  betaPriorAlpha: 1,
  betaPriorBeta: 1,
};

const defaultState = {
  settings: defaultSettings,
  cycles: [],
  ledger: [],
};

function currency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function pct(value) {
  return `${((Number.isFinite(value) ? value : 0) * 100).toFixed(2)}%`;
}

function powerOfTwoFloor(value, minBet = 1) {
  if (!Number.isFinite(value) || value < minBet) return 0;
  let bet = minBet;
  while (bet * 2 <= value) bet *= 2;
  return bet;
}

function cycleLossProbability(probabilities) {
  return probabilities.reduce((acc, p) => acc * (1 - Number(p || 0)), 1);
}

function cycleWinProbability(probabilities) {
  return 1 - cycleLossProbability(probabilities);
}

function expectedCycleProfit(baseBet, probabilities, payoutRate) {
  const bets = [baseBet, baseBet * 2, baseBet * 4];
  let expected = 0;
  let reachProb = 1;

  for (let i = 0; i < 3; i += 1) {
    const previousLosses = bets.slice(0, i).reduce((a, b) => a + b, 0);
    const winNet = bets[i] * payoutRate - previousLosses;
    expected += reachProb * probabilities[i] * winNet;
    reachProb *= 1 - probabilities[i];
  }

  const fullLoss = bets.reduce((a, b) => a + b, 0);
  expected += reachProb * -fullLoss;
  return expected;
}

function netForOutcome(baseBet, outcome, payoutRate) {
  const bets = [baseBet, baseBet * 2, baseBet * 4];
  if (outcome === 'single-loss') return -baseBet;
  if (outcome === 'loss') return -bets.reduce((a, b) => a + b, 0);
  const idx = Number(outcome) - 1;
  const previousLosses = bets.slice(0, idx).reduce((a, b) => a + b, 0);
  return bets[idx] * payoutRate - previousLosses;
}

function getOutcomeLabel(outcome) {
  if (outcome === 'single-loss') return 'Pierde solo base';
  if (outcome === 'loss') return 'Pierde 3';
  return `Gana ${outcome}`;
}

function didReachAttempt(outcome, attemptIndex) {
  if (outcome === 'single-loss') return attemptIndex === 0;
  if (outcome === 'loss') return true;
  return Number(outcome) >= attemptIndex + 1;
}

function getAttemptStats(cycles, attemptIndex, alpha, beta) {
  let reached = 0;
  let wins = 0;

  for (const cycle of cycles) {
    const outcome = cycle.outcome;
    if (didReachAttempt(outcome, attemptIndex)) {
      reached += 1;
      if (Number(outcome) === attemptIndex + 1) wins += 1;
    }
  }

  const posterior = (wins + alpha) / (reached + alpha + beta);
  return { reached, wins, losses: reached - wins, posterior };
}

function daysBetween(a, b) {
  const ms = new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function buildProjection(settings, cycles) {
  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = daysBetween(today, settings.goalDate);
  const weeksLeft = daysLeft / 7;
  const remainingCycles = Math.round(weeksLeft * Number(settings.weeklyDays || 0) * Number(settings.dailyCycles || 0));
  const pLossCycle = cycleLossProbability(settings.probabilities);
  const chanceAtLeastOneFullLoss = 1 - Math.pow(1 - pLossCycle, remainingCycles);
  const baseLimit = Number(settings.currentCapital || 0) * Number(settings.maxBaseBetPct || 0);
  const baseBet = powerOfTwoFloor(baseLimit, Number(settings.minBet || 1));
  const maxCycleExposure = baseBet * 7;
  const expectedPerCycle = expectedCycleProfit(baseBet, settings.probabilities, settings.payoutRate);
  const expectedRemaining = expectedPerCycle * remainingCycles;
  const targetGap = Number(settings.goal || 0) - Number(settings.currentCapital || 0);
  const neededPerCycle = remainingCycles > 0 ? targetGap / remainingCycles : 0;
  const neededBase = expectedPerCycle > 0 && baseBet > 0 ? (neededPerCycle / expectedPerCycle) * baseBet : 0;

  return {
    daysLeft,
    remainingCycles,
    pLossCycle,
    chanceAtLeastOneFullLoss,
    baseBet,
    maxCycleExposure,
    expectedPerCycle,
    expectedRemaining,
    targetGap,
    neededPerCycle,
    neededBase,
    totalCycles: cycles.length,
  };
}

function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="card stat-card">
      <div className="stat-icon"><Icon size={20} /></div>
      <div>
        <p className="muted small">{label}</p>
        <h3>{value}</h3>
        {hint && <p className="muted small">{hint}</p>}
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : defaultState;
    } catch {
      return defaultState;
    }
  });

  const [cycleForm, setCycleForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    baseBet: '',
    outcome: '1',
    note: '',
  });

  const [ledgerForm, setLedgerForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    type: 'withdrawal',
    amount: '',
    note: '',
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const settings = state.settings;
  const projection = useMemo(() => buildProjection(settings, state.cycles), [settings, state.cycles]);

  const attemptStats = useMemo(
    () => [0, 1, 2].map((idx) => getAttemptStats(
      state.cycles,
      idx,
      Number(settings.betaPriorAlpha || 1),
      Number(settings.betaPriorBeta || 1),
    )),
    [state.cycles, settings.betaPriorAlpha, settings.betaPriorBeta],
  );

  const chartData = useMemo(() => {
    let capital = Number(settings.initialCapital || 0);

    const cycleEvents = state.cycles.map((cycle) => ({
      id: cycle.id,
      date: cycle.date,
      label: `Ciclo: ${getOutcomeLabel(cycle.outcome)}`,
      amount: Number(cycle.net || 0),
      type: 'cycle',
    }));

    const ledgerEvents = state.ledger.map((item) => ({
      id: item.id,
      date: item.date,
      label: item.type === 'withdrawal' ? 'Retiro' : 'Depósito',
      amount: item.type === 'withdrawal' ? -Number(item.amount || 0) : Number(item.amount || 0),
      type: item.type,
    }));

    const events = [...cycleEvents, ...ledgerEvents].sort((a, b) => {
      const dateDiff = new Date(a.date) - new Date(b.date);
      if (dateDiff !== 0) return dateDiff;
      return String(a.id).localeCompare(String(b.id));
    });

    const rows = [{ name: 'Inicio', capital }];

    events.forEach((event, idx) => {
      capital += event.amount;
      rows.push({
        name: `${idx + 1}`,
        capital: Number(capital.toFixed(2)),
        evento: event.label,
        cambio: Number(event.amount.toFixed(2)),
        fecha: event.date,
      });
    });

    return rows;
  }, [state.cycles, state.ledger, settings.initialCapital]);

  const totalWithdrawals = state.ledger
    .filter((item) => item.type === 'withdrawal')
    .reduce((acc, item) => acc + Number(item.amount || 0), 0);
  const totalDeposits = state.ledger
    .filter((item) => item.type === 'deposit')
    .reduce((acc, item) => acc + Number(item.amount || 0), 0);
  const totalProfit = Number(settings.currentCapital || 0) + totalWithdrawals - Number(settings.initialCapital || 0) - totalDeposits;
  const recommendedWithdrawal = Math.max(0, totalProfit * Number(settings.withdrawalPct || 0));

  function updateSetting(key, value) {
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        [key]: value,
      },
    }));
  }

  function updateProbability(index, value) {
    const probabilities = [...settings.probabilities];
    probabilities[index] = Math.max(0, Math.min(1, Number(value)));
    updateSetting('probabilities', probabilities);
  }

  function addCycle(event) {
    event.preventDefault();
    const baseBet = Number(cycleForm.baseBet || projection.baseBet || 0);
    if (baseBet <= 0) return;
    const net = netForOutcome(baseBet, cycleForm.outcome, Number(settings.payoutRate || 0));
    const cycle = {
      id: crypto.randomUUID(),
      date: cycleForm.date,
      baseBet,
      outcome: cycleForm.outcome,
      net,
      note: cycleForm.note,
    };

    setState((prev) => ({
      ...prev,
      cycles: [cycle, ...prev.cycles],
      settings: {
        ...prev.settings,
        currentCapital: Number(prev.settings.currentCapital || 0) + net,
      },
    }));
    setCycleForm({ ...cycleForm, baseBet: '', note: '' });
  }

  function addLedger(event) {
    event.preventDefault();
    const amount = Number(ledgerForm.amount || 0);
    if (amount <= 0) return;
    const sign = ledgerForm.type === 'withdrawal' ? -1 : 1;
    const item = { id: crypto.randomUUID(), ...ledgerForm, amount };
    setState((prev) => ({
      ...prev,
      ledger: [item, ...prev.ledger],
      settings: {
        ...prev.settings,
        currentCapital: Math.max(0, Number(prev.settings.currentCapital || 0) + sign * amount),
      },
    }));
    setLedgerForm({ ...ledgerForm, amount: '', note: '' });
  }

  function applyPosteriorProbabilities() {
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        probabilities: attemptStats.map((stat) => Number(stat.posterior.toFixed(4))),
      },
    }));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `risk-control-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (parsed.settings && parsed.cycles && parsed.ledger) setState(parsed);
      } catch {
        alert('No se pudo importar el archivo. Revisa que sea un JSON válido.');
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    const ok = confirm('Esto borra todos los datos guardados en este navegador. ¿Continuar?');
    if (ok) setState(defaultState);
  }

  const progress = Math.max(0, Math.min(100, (Number(settings.currentCapital || 0) / Number(settings.goal || 1)) * 100));

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Risk Control App</p>
          <h1>Simulador, registro y control de capital</h1>
          <p className="hero-text">
            Esta app no recomienda apostar. Calcula límites hipotéticos, registra resultados, actualiza probabilidades con datos reales y ayuda a controlar retiros y exposición.
          </p>
        </div>
        <div className="hero-actions">
          <button onClick={exportData} className="secondary"><Download size={18} /> Exportar</button>
          <label className="secondary file-button"><Upload size={18} /> Importar <input type="file" accept="application/json" onChange={importData} /></label>
          <button onClick={resetAll} className="danger"><RefreshCcw size={18} /> Reiniciar</button>
        </div>
      </section>

      <section className="warning card">
        <AlertTriangle size={24} />
        <div>
          <strong>Control de riesgo</strong>
          <p>
            La app no recomienda apostar. Muestra métricas de control como capital actual, ganancias netas, retiros, depósitos, límites hipotéticos por reglas, exposición máxima y riesgo acumulado. El límite base usa potencia de 2 y máximo {pct(Number(settings.maxBaseBetPct || 0))} del capital.
          </p>
        </div>
      </section>

      <section className="grid stats-grid">
        <StatCard icon={Wallet} label="Capital actual" value={currency(settings.currentCapital)} hint={`Meta: ${currency(settings.goal)}`} />
        <StatCard icon={Target} label="Progreso hacia la meta" value={`${progress.toFixed(1)}%`} hint={`${projection.daysLeft} días restantes`} />
        <StatCard icon={TrendingUp} label="Ganancias netas" value={currency(totalProfit)} hint={`Retiro sugerido: ${currency(recommendedWithdrawal)}`} />
        <StatCard icon={PiggyBank} label="Retiros totales" value={currency(totalWithdrawals)} hint={`Depósitos: ${currency(totalDeposits)}`} />
        <StatCard icon={Calculator} label="Límite base hipotético" value={currency(projection.baseBet)} hint={`Exposición máx. ciclo: ${currency(projection.maxCycleExposure)}`} />
      </section>

      <section className="grid two-cols">
        <div className="card">
          <div className="section-title"><BarChart3 size={20} /><h2>Riesgo del ciclo</h2></div>
          <div className="metric-row"><span>Prob. ganar el ciclo</span><strong>{pct(cycleWinProbability(settings.probabilities))}</strong></div>
          <div className="metric-row"><span>Prob. perder los 3 intentos</span><strong>{pct(projection.pLossCycle)}</strong></div>
          <div className="metric-row"><span>Prob. de al menos una pérdida completa restante</span><strong>{pct(projection.chanceAtLeastOneFullLoss)}</strong></div>
          <div className="metric-row"><span>Valor esperado por ciclo hipotético</span><strong>{currency(projection.expectedPerCycle)}</strong></div>
          <div className="metric-row"><span>Ciclos restantes estimados</span><strong>{projection.remainingCycles}</strong></div>
        </div>

        <div className="card">
          <div className="section-title"><PiggyBank size={20} /><h2>Retiros</h2></div>
          <p className="muted">Ganancia neta estimada: {currency(totalProfit)}</p>
          <div className="recommendation-box">
            <span>Retiro conservador sugerido</span>
            <strong>{currency(recommendedWithdrawal)}</strong>
            <small>{pct(Number(settings.withdrawalPct || 0))} de ganancias netas, no del capital base.</small>
          </div>
          <form onSubmit={addLedger} className="form-grid compact-form">
            <input type="date" value={ledgerForm.date} onChange={(e) => setLedgerForm({ ...ledgerForm, date: e.target.value })} />
            <select value={ledgerForm.type} onChange={(e) => setLedgerForm({ ...ledgerForm, type: e.target.value })}>
              <option value="withdrawal">Retiro</option>
              <option value="deposit">Depósito</option>
            </select>
            <input type="number" min="0" step="0.01" placeholder="Monto" value={ledgerForm.amount} onChange={(e) => setLedgerForm({ ...ledgerForm, amount: e.target.value })} />
            <button type="submit">Registrar</button>
          </form>
        </div>
      </section>

      <section className="grid two-cols">
        <div className="card">
          <h2>Configuración</h2>
          <div className="form-grid">
            <label>Capital inicial<input type="number" value={settings.initialCapital} onChange={(e) => updateSetting('initialCapital', Number(e.target.value))} /></label>
            <label>Capital actual<input type="number" value={settings.currentCapital} onChange={(e) => updateSetting('currentCapital', Number(e.target.value))} /></label>
            <label>Meta<input type="number" value={settings.goal} onChange={(e) => updateSetting('goal', Number(e.target.value))} /></label>
            <label>Fecha objetivo<input type="date" value={settings.goalDate} onChange={(e) => updateSetting('goalDate', e.target.value)} /></label>
            <label>Retorno si gana<input type="number" step="0.01" value={settings.payoutRate} onChange={(e) => updateSetting('payoutRate', Number(e.target.value))} /></label>
            <label>Máx. base / capital<input type="number" step="0.001" value={settings.maxBaseBetPct} onChange={(e) => updateSetting('maxBaseBetPct', Number(e.target.value))} /></label>
            <label>Ciclos por día<input type="number" value={settings.dailyCycles} onChange={(e) => updateSetting('dailyCycles', Number(e.target.value))} /></label>
            <label>Días por semana<input type="number" value={settings.weeklyDays} onChange={(e) => updateSetting('weeklyDays', Number(e.target.value))} /></label>
            <label>% retiro ganancias<input type="number" step="0.01" value={settings.withdrawalPct} onChange={(e) => updateSetting('withdrawalPct', Number(e.target.value))} /></label>
            <label>Apuesta mínima<input type="number" value={settings.minBet} onChange={(e) => updateSetting('minBet', Number(e.target.value))} /></label>
          </div>
          <h3>Probabilidades manuales</h3>
          <div className="form-grid three-cols">
            {[0, 1, 2].map((idx) => (
              <label key={idx}>Intento {idx + 1}<input type="number" min="0" max="1" step="0.001" value={settings.probabilities[idx]} onChange={(e) => updateProbability(idx, e.target.value)} /></label>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Registrar ciclo</h2>
          <form onSubmit={addCycle} className="form-grid">
            <label>Fecha<input type="date" value={cycleForm.date} onChange={(e) => setCycleForm({ ...cycleForm, date: e.target.value })} /></label>
            <label>Apuesta base<input type="number" min="0" step="1" placeholder={projection.baseBet} value={cycleForm.baseBet} onChange={(e) => setCycleForm({ ...cycleForm, baseBet: e.target.value })} /></label>
            <label>Resultado<select value={cycleForm.outcome} onChange={(e) => setCycleForm({ ...cycleForm, outcome: e.target.value })}>
              <option value="1">Ganó intento 1</option>
              <option value="2">Ganó intento 2</option>
              <option value="3">Ganó intento 3</option>
              <option value="single-loss">Perdió solo la apuesta base</option>
              <option value="loss">Perdió los 3</option>
            </select></label>
            <label>Nota<input value={cycleForm.note} onChange={(e) => setCycleForm({ ...cycleForm, note: e.target.value })} placeholder="Opcional" /></label>
            <button type="submit">Guardar ciclo</button>
          </form>

          <h3>Probabilidades ajustadas por datos</h3>
          <div className="prob-table">
            {attemptStats.map((stat, idx) => (
              <div key={idx} className="prob-row">
                <span>Intento {idx + 1}</span>
                <strong>{pct(stat.posterior)}</strong>
                <small>{stat.wins}/{stat.reached} ganados al llegar</small>
              </div>
            ))}
          </div>
          <button onClick={applyPosteriorProbabilities} className="secondary full-width">Usar probabilidades ajustadas</button>
        </div>
      </section>

      <section className="card">
        <h2>Evolución del capital</h2>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip
                formatter={(value, name) => (name === 'capital' || name === 'cambio' ? currency(value) : value)}
                labelFormatter={(label, payload) => {
                  const item = payload?.[0]?.payload;
                  return item?.fecha ? `${item.fecha} · ${item.evento || label}` : label;
                }}
              />
              <Area type="monotone" dataKey="capital" strokeWidth={2} fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid two-cols">
        <div className="card">
          <h2>Historial de ciclos</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Base</th><th>Resultado</th><th>Neto</th></tr></thead>
              <tbody>
                {state.cycles.slice(0, 20).map((cycle) => (
                  <tr key={cycle.id}><td>{cycle.date}</td><td>{currency(cycle.baseBet)}</td><td>{getOutcomeLabel(cycle.outcome)}</td><td className={cycle.net >= 0 ? 'positive' : 'negative'}>{currency(cycle.net)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Movimientos de capital</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th></tr></thead>
              <tbody>
                {state.ledger.slice(0, 20).map((item) => (
                  <tr key={item.id}><td>{item.date}</td><td>{item.type === 'withdrawal' ? 'Retiro' : 'Depósito'}</td><td>{currency(item.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
