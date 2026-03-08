const contributorsList = document.getElementById("contributorsList");
const contributorTemplate = document.getElementById("contributorTemplate");
const addContributorBtn = document.getElementById("addContributorBtn");
const calculateBtn = document.getElementById("calculateBtn");
const loadDemoBtn = document.getElementById("loadDemoBtn");
const resetPlanBtn = document.getElementById("resetPlanBtn");
const resultState = document.getElementById("resultState");
const resultsEl = document.getElementById("results");
const scoreCardEl = document.getElementById("scoreCard");
const comparisonEl = document.getElementById("comparison");

const currencyEl = document.getElementById("currency");
const methodEl = document.getElementById("contributionMethod");
const currentBalanceEl = document.getElementById("currentBalance");
const targetBalanceEl = document.getElementById("targetBalance");
const minContributionPctEl = document.getElementById("minContributionPct");
const maxContributionPctEl = document.getElementById("maxContributionPct");

function addContributor(defaultName = "", defaultSalary = "") {
  const node = contributorTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".contributor-name").value = defaultName;
  node.querySelector(".contributor-salary").value = defaultSalary;

  const removeBtn = node.querySelector(".remove-btn");
  removeBtn.addEventListener("click", () => {
    node.remove();
    const rowCount = contributorsList.querySelectorAll(".contributor-row").length;
    if (rowCount === 0) {
      addContributor();
    }
  });

  contributorsList.appendChild(node);
}

function resetContributors() {
  contributorsList.innerHTML = "";
}

function moneyFormatter() {
  const currency = currencyEl.value;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

function readContributors() {
  const issues = [];
  const contributors = [...contributorsList.querySelectorAll(".contributor-row")].map((row, index) => {
    const nameInput = row.querySelector(".contributor-name");
    const salaryInput = row.querySelector(".contributor-salary");
    const name = nameInput.value.trim() || `Contributor ${index + 1}`;
    const salaryRaw = salaryInput.value.trim();
    const salary = Number(salaryRaw);

    if (salaryRaw === "") {
      issues.push(`Enter a monthly salary for ${name}.`);
      return null;
    }

    if (!Number.isFinite(salary) || salary < 0) {
      issues.push(`Salary for ${name} must be 0 or higher.`);
      return null;
    }

    return { name, salary };
  });

  return {
    contributors: contributors.filter(Boolean),
    issues,
  };
}

function renderError(message) {
  resultState.innerHTML = `<span class="error">${message}</span>`;
  resultsEl.innerHTML = "";
  scoreCardEl.classList.add("hidden");
  scoreCardEl.innerHTML = "";
  comparisonEl.classList.add("hidden");
  comparisonEl.innerHTML = "";
}

function renderInitialState() {
  resultState.innerHTML =
    "<strong>No plan yet.</strong> Load the example or enter your own values, then click <strong>Calculate contributions</strong>.";
  resultsEl.innerHTML = "";
  scoreCardEl.classList.add("hidden");
  scoreCardEl.innerHTML = "";
  comparisonEl.classList.add("hidden");
  comparisonEl.innerHTML = "";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function parseGuardrails() {
  const minPct = Number(minContributionPctEl.value);
  const maxPct = Number(maxContributionPctEl.value);

  if (!Number.isFinite(minPct) || minPct < 0 || minPct > 100) {
    return { issue: "Minimum contribution % must be between 0 and 100." };
  }

  if (!Number.isFinite(maxPct) || maxPct < 0 || maxPct > 100) {
    return { issue: "Maximum contribution % must be between 0 and 100." };
  }

  if (minPct > maxPct) {
    return { issue: "Minimum contribution % cannot be greater than maximum contribution %." };
  }

  return { minPct, maxPct };
}

function allocateWithGuardrails(people, monthlyNeeded, method, minPct, maxPct) {
  const minFactor = minPct / 100;
  const maxFactor = maxPct / 100;

  const withBounds = people.map((person) => {
    const min = person.salary * minFactor;
    const max = person.salary * maxFactor;
    return { ...person, min, max };
  });

  const totalMin = withBounds.reduce((sum, person) => sum + person.min, 0);
  const totalMax = withBounds.reduce((sum, person) => sum + person.max, 0);

  let targetToAllocate = monthlyNeeded;
  let status = "exact";
  let note = "";

  if (monthlyNeeded < totalMin) {
    targetToAllocate = totalMin;
    status = "overshoot";
    note = `Guardrails force a minimum total contribution of ${totalMin.toFixed(2)}, which is above the amount needed.`;
  } else if (monthlyNeeded > totalMax) {
    targetToAllocate = totalMax;
    status = "shortfall";
    note = `Guardrails cap total contribution at ${totalMax.toFixed(2)}, so the target cannot be fully reached.`;
  }

  let remaining = targetToAllocate - totalMin;
  const additions = withBounds.map(() => 0);
  const additionalCaps = withBounds.map((person) => Math.max(0, person.max - person.min));

  const methodWeights = withBounds.map((person) => {
    if (method === "proportional") {
      return person.salary;
    }
    return 1;
  });

  let active = additionalCaps.map((cap, index) => (cap > 0 ? index : -1)).filter((index) => index >= 0);
  let safetyCounter = 0;

  while (remaining > 1e-8 && active.length > 0 && safetyCounter < 50) {
    safetyCounter += 1;
    const totalWeight = active.reduce((sum, index) => sum + (methodWeights[index] > 0 ? methodWeights[index] : 0), 0);
    const fallbackWeight = totalWeight <= 0 ? active.length : totalWeight;

    const saturated = [];

    active.forEach((index) => {
      const weight = methodWeights[index] > 0 ? methodWeights[index] : 1;
      const share = remaining * (weight / fallbackWeight);
      const allowed = additionalCaps[index] - additions[index];
      const used = Math.min(share, allowed);
      additions[index] += used;

      if (allowed - used <= 1e-8) {
        saturated.push(index);
      }
    });

    const usedTotal = additions.reduce((sum, value) => sum + value, 0);
    remaining = Math.max(0, targetToAllocate - totalMin - usedTotal);
    active = active.filter((index) => !saturated.includes(index));
  }

  const contributions = withBounds.map((person, index) => person.min + additions[index]);
  const deliveredTotal = contributions.reduce((sum, value) => sum + value, 0);

  const resultPeople = withBounds.map((person, index) => ({
    name: person.name,
    salary: person.salary,
    contribution: contributions[index],
    leftForPersonal: person.salary - contributions[index],
  }));

  return {
    people: resultPeople,
    status,
    note,
    totalMin,
    totalMax,
    deliveredTotal,
    uncoveredGap: Math.max(0, monthlyNeeded - deliveredTotal),
    forcedExcess: Math.max(0, deliveredTotal - monthlyNeeded),
  };
}

function enrichPeople(people) {
  const totalSalary = people.reduce((sum, person) => sum + person.salary, 0);
  const totalContribution = people.reduce((sum, person) => sum + person.contribution, 0);

  return people.map((person) => {
    const burdenPct = person.salary > 0 ? (person.contribution / person.salary) * 100 : 0;
    const incomeSharePct = totalSalary > 0 ? (person.salary / totalSalary) * 100 : 0;
    const contributionSharePct = totalContribution > 0 ? (person.contribution / totalContribution) * 100 : 0;

    return {
      ...person,
      burdenPct,
      incomeSharePct,
      contributionSharePct,
    };
  });
}

function computeReadinessScore({ monthlyNeeded, totalSalary, overloadedPeople, heavyBurdenPeople, method, uncoveredGap }) {
  const needsRatio = totalSalary > 0 ? (monthlyNeeded / totalSalary) * 100 : 0;
  const ratioPenalty = Math.min(60, needsRatio * 0.9);
  const overloadPenalty = overloadedPeople.length * 25;
  const burdenPenalty = heavyBurdenPeople.length * 12;
  const gapPenalty = totalSalary > 0 ? Math.min(25, (uncoveredGap / totalSalary) * 100 * 1.2) : uncoveredGap > 0 ? 25 : 0;
  const methodBonus = method === "proportional" && heavyBurdenPeople.length === 0 ? 4 : 0;
  const targetMetBonus = monthlyNeeded === 0 ? 10 : 0;

  let score = 100 - ratioPenalty - overloadPenalty - burdenPenalty - gapPenalty + methodBonus + targetMetBonus;
  score = clamp(Math.round(score), 0, 100);

  let label = "Strong";
  if (score < 50) {
    label = "At risk";
  } else if (score < 75) {
    label = "Watch closely";
  }

  const breakdown = [
    "Base score: 100",
    `Need vs income impact: -${ratioPenalty.toFixed(1)} (${needsRatio.toFixed(1)}% of monthly income needed)`,
    `Negative personal balance risk: -${overloadPenalty} (${overloadedPeople.length} contributor(s))`,
    `High burden impact: -${burdenPenalty} (${heavyBurdenPeople.length} contributor(s) above 50% burden)`,
    `Guardrail shortfall impact: -${gapPenalty.toFixed(1)} (${uncoveredGap > 0 ? "target not fully covered" : "no shortfall"})`,
  ];

  if (methodBonus > 0) {
    breakdown.push(`Proportional fairness bonus: +${methodBonus}`);
  }

  if (targetMetBonus > 0) {
    breakdown.push(`Target already met bonus: +${targetMetBonus}`);
  }

  return { score, label, breakdown };
}

function renderScoreCard(scoreData) {
  const { score, label, breakdown } = scoreData;
  const tone = score >= 75 ? "good" : score >= 50 ? "medium" : "risk";

  scoreCardEl.className = `score-card ${tone}`;
  scoreCardEl.innerHTML = `
    <div class="score-top">
      <div class="score-title-row">
        <p class="score-label">Plan confidence score</p>
        <span class="score-info">
          <button type="button" class="info-trigger" aria-label="How this score is calculated">i</button>
          <div class="score-tooltip" role="tooltip">
            <p><strong>How the score works</strong></p>
            <p><strong>Need vs income:</strong> Higher required % of household income lowers score.</p>
            <p><strong>Negative balance risk:</strong> Penalises plans where someone goes below 0 personal money.</p>
            <p><strong>High burden:</strong> Penalises contributors above 50% salary burden.</p>
            <p><strong>Guardrail shortfall:</strong> Penalises when min/max limits prevent reaching target.</p>
            <p><strong>Bonuses:</strong> Small boost when proportional split is balanced, plus target-already-met bonus.</p>
          </div>
        </span>
      </div>
      <div class="score-value">${score}<span>/100</span></div>
      <p class="score-status">${label}</p>
    </div>
    <div class="score-explainer">
      <p><strong>Current score breakdown</strong></p>
      ${breakdown.map((line) => `<p>${line}</p>`).join("")}
    </div>
  `;
}

function renderComparison(equalPlan, proportionalPlan, formatter) {
  const names = equalPlan.people.map((person) => person.name);

  const rows = names
    .map((name, index) => {
      const equalContribution = equalPlan.people[index]?.contribution ?? 0;
      const proportionalContribution = proportionalPlan.people[index]?.contribution ?? 0;
      const delta = proportionalContribution - equalContribution;
      const deltaLabel = delta >= 0 ? `+${formatter.format(delta)}` : `-${formatter.format(Math.abs(delta))}`;

      return `
        <article class="comparison-row">
          <div><strong>${name}</strong></div>
          <div>${formatter.format(equalContribution)}</div>
          <div>${formatter.format(proportionalContribution)}</div>
          <div class="${delta === 0 ? "delta-neutral" : delta > 0 ? "delta-up" : "delta-down"}">${deltaLabel}</div>
        </article>
      `;
    })
    .join("");

  const equalTotal = equalPlan.deliveredTotal;
  const proportionalTotal = proportionalPlan.deliveredTotal;

  comparisonEl.className = "comparison";
  comparisonEl.innerHTML = `
    <h3>Equal vs proportional comparison</h3>
    <p>Delta shows <strong>Proportional minus Equal</strong> contribution per person under current guardrails.</p>
    <div class="comparison-head comparison-row">
      <div>Contributor</div>
      <div>Equal</div>
      <div>Proportional</div>
      <div>Delta</div>
    </div>
    ${rows}
    <div class="comparison-totals">
      <p><strong>Total (Equal):</strong> ${formatter.format(equalTotal)}</p>
      <p><strong>Total (Proportional):</strong> ${formatter.format(proportionalTotal)}</p>
    </div>
  `;
}

function renderResults(calc, formatter) {
  const { people, monthlyNeeded, currentBalance, targetBalance, totalSalary, method, activePlan, equalPlan, proportionalPlan, minPct, maxPct } = calc;
  const formatPercent = (value) => `${value.toFixed(1)}%`;

  const guardrailText = `Guardrails: min ${formatPercent(minPct)} / max ${formatPercent(maxPct)} of salary.`;
  const coverageText = activePlan.uncoveredGap > 0
    ? `<span class="error">Shortfall after guardrails: ${formatter.format(activePlan.uncoveredGap)}.</span>`
    : activePlan.forcedExcess > 0
      ? `<span class="warning">Guardrails force excess contribution: ${formatter.format(activePlan.forcedExcess)}.</span>`
      : "Target is fully covered under current guardrails.";

  resultState.innerHTML = `
    <strong>Monthly amount needed:</strong> ${formatter.format(monthlyNeeded)}
    <br />
    Current balance: ${formatter.format(currentBalance)} | Target balance: ${formatter.format(targetBalance)}
    <br />
    ${guardrailText}
    <br />
    ${coverageText}
  `;

  const rows = people
    .map((person) => {
      const personal = `<small>Left for personal account: ${formatter.format(person.leftForPersonal)}</small>`;
      const burdenText =
        person.salary > 0
          ? `<small>Contribution burden: ${formatPercent(person.burdenPct)} of salary</small>`
          : `<small>Contribution burden: ${person.contribution > 0 ? "No salary available for this split" : "0.0% of salary"}</small>`;
      const shareText = `<small>Income share: ${formatPercent(person.incomeSharePct)} | Contribution share: ${formatPercent(person.contributionSharePct)}</small>`;

      return `
        <article class="result-row">
          <div>
            <strong>${person.name}</strong>
            ${personal}
            ${burdenText}
            ${shareText}
          </div>
          <div><strong>${formatter.format(person.contribution)}</strong></div>
        </article>
      `;
    })
    .join("");

  const totalContribution = people.reduce((sum, person) => sum + person.contribution, 0);
  const totalLeftForPersonal = people.reduce((sum, person) => sum + person.leftForPersonal, 0);
  const averageLeftForPersonal = people.length ? totalLeftForPersonal / people.length : 0;
  const highestContributionPerson = [...people].sort((a, b) => b.contribution - a.contribution)[0];
  const overloadedPeople = people.filter((person) => person.leftForPersonal < 0);
  const heavyBurdenPeople = people.filter((person) => person.burdenPct > 50);
  const needsRatio = totalSalary > 0 ? (monthlyNeeded / totalSalary) * 100 : 0;

  const scoreData = computeReadinessScore({
    monthlyNeeded,
    totalSalary,
    overloadedPeople,
    heavyBurdenPeople,
    method,
    uncoveredGap: activePlan.uncoveredGap,
  });
  renderScoreCard(scoreData);

  const insights = [];
  const addInsight = (text, tone = "neutral") => {
    insights.push({ text, tone });
  };
  addInsight(`Combined monthly salary: <strong>${formatter.format(totalSalary)}</strong>.`);
  addInsight(`Total assigned contribution: <strong>${formatter.format(totalContribution)}</strong>.`);
  addInsight(`Constraint range from guardrails: <strong>${formatter.format(activePlan.totalMin)}</strong> to <strong>${formatter.format(activePlan.totalMax)}</strong>.`);

  if (monthlyNeeded === 0) {
    addInsight("Target is already met, so this month requires no additional transfer.", "positive");
  } else {
    addInsight(`Required contribution equals <strong>${formatPercent(needsRatio)}</strong> of combined monthly income.`);
  }

  if (method === "proportional") {
    addInsight("Proportional mode keeps contribution share aligned with income share.");
  } else {
    addInsight("Equal mode gives the same transfer amount to each contributor.");
  }

  if (activePlan.status !== "exact") {
    addInsight(`<strong>Guardrail impact:</strong> ${activePlan.note}`, "warning");
  }

  if (highestContributionPerson) {
    const highestShare = totalContribution > 0 ? (highestContributionPerson.contribution / totalContribution) * 100 : 0;
    addInsight(
      `Largest contributor this month: <strong>${highestContributionPerson.name}</strong> with ${formatter.format(highestContributionPerson.contribution)} (${formatPercent(highestShare)} of total contribution).`,
    );
  }

  addInsight(`Total personal money left after contributions: <strong>${formatter.format(totalLeftForPersonal)}</strong>.`);
  addInsight(`Average personal money left per contributor: <strong>${formatter.format(averageLeftForPersonal)}</strong>.`);

  if (overloadedPeople.length > 0) {
    addInsight(`<strong>Attention:</strong> ${overloadedPeople.map((person) => person.name).join(", ")} goes negative after contribution.`, "warning");
  } else {
    addInsight("No contributor goes negative after contribution.", "positive");
  }

  if (heavyBurdenPeople.length > 0) {
    addInsight(
      `<strong>Attention:</strong> ${heavyBurdenPeople.map((person) => person.name).join(", ")} contributes more than 50% of salary.`,
      "warning",
    );
  } else {
    addInsight("Contribution burden remains at or below 50% for everyone.", "positive");
  }

  resultsEl.innerHTML = `
    ${rows}
    <article class="insight-box">
      <div class="insight-header">
        <p class="insight-kicker">Interpretation</p>
        <h3>What this split means</h3>
      </div>
      <div class="insight-grid">
        ${insights.map((item) => `<p class="insight-item ${item.tone}">${item.text}</p>`).join("")}
      </div>
    </article>
  `;

  renderComparison(equalPlan, proportionalPlan, formatter);
}

function calculate() {
  const formatter = moneyFormatter();
  const method = methodEl.value;
  const currentBalance = Number(currentBalanceEl.value);
  const targetBalance = Number(targetBalanceEl.value);

  if (!Number.isFinite(currentBalance) || currentBalance < 0) {
    renderError("Current balance must be a valid number greater than or equal to 0.");
    return;
  }

  if (!Number.isFinite(targetBalance) || targetBalance < 0) {
    renderError("Target balance must be a valid number greater than or equal to 0.");
    return;
  }

  const guardrails = parseGuardrails();
  if (guardrails.issue) {
    renderError(guardrails.issue);
    return;
  }

  const { contributors, issues } = readContributors();
  if (issues.length > 0) {
    renderError(issues[0]);
    return;
  }

  if (!contributors.length) {
    renderError("Add at least one contributor and salary to generate a plan.");
    return;
  }

  const totalSalary = contributors.reduce((sum, person) => sum + person.salary, 0);
  const monthlyNeeded = Math.max(targetBalance - currentBalance, 0);

  if (totalSalary <= 0 && monthlyNeeded > 0) {
    renderError("Total salary must be above 0 when the target is above the current balance.");
    return;
  }

  const equalPlanRaw = allocateWithGuardrails(contributors, monthlyNeeded, "equal", guardrails.minPct, guardrails.maxPct);
  const proportionalPlanRaw = allocateWithGuardrails(contributors, monthlyNeeded, "proportional", guardrails.minPct, guardrails.maxPct);

  const equalPlan = {
    ...equalPlanRaw,
    people: enrichPeople(equalPlanRaw.people),
  };

  const proportionalPlan = {
    ...proportionalPlanRaw,
    people: enrichPeople(proportionalPlanRaw.people),
  };

  const activePlan = method === "equal" ? equalPlan : proportionalPlan;

  renderResults(
    {
      people: activePlan.people,
      monthlyNeeded,
      currentBalance,
      targetBalance,
      totalSalary,
      method,
      activePlan,
      equalPlan,
      proportionalPlan,
      minPct: guardrails.minPct,
      maxPct: guardrails.maxPct,
    },
    formatter,
  );
}

function loadDemoData() {
  currencyEl.value = "USD";
  methodEl.value = "proportional";
  currentBalanceEl.value = "1200";
  targetBalanceEl.value = "3600";
  minContributionPctEl.value = "0";
  maxContributionPctEl.value = "35";

  resetContributors();
  addContributor("Maya", "6200");
  addContributor("Ethan", "4800");

  calculate();
}

function resetPlan() {
  currencyEl.value = "USD";
  methodEl.value = "equal";
  currentBalanceEl.value = "0";
  targetBalanceEl.value = "0";
  minContributionPctEl.value = "0";
  maxContributionPctEl.value = "100";

  resetContributors();
  addContributor("Member 1", "0");
  addContributor("Member 2", "0");
  renderInitialState();
}

addContributorBtn.addEventListener("click", () => addContributor());
calculateBtn.addEventListener("click", calculate);
loadDemoBtn.addEventListener("click", loadDemoData);
resetPlanBtn.addEventListener("click", resetPlan);

resetPlan();
