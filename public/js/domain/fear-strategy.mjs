// The re-arm buffer is a strategy rule, not a statistical confidence interval.
export function calculateFearSignals(rows, sentiment, { baseAmount = 1000, fearThreshold = 10 } = {}) {
  if (
    !Number.isFinite(fearThreshold) ||
    fearThreshold <= 0 ||
    fearThreshold > 95 ||
    !Number.isFinite(baseAmount) ||
    baseAmount < 0.01
  ) {
    throw Error('恐慌阈值须大于 0 且不超过 95，N 须不小于 0.01');
  }
  for (let i = 0; i < rows.length; i++) {
    if (i && rows[i].date <= rows[i - 1].date) {
      throw Error('行情日期必须递增且不重复');
    }
  }

  const signals = [];
  let previous = null;
  let armed = true;
  let tradeIndex = 0;

  for (const row of sentiment) {
    if (previous && row.date <= previous.date) {
      throw Error('指数日期必须递增且不重复');
    }
    if (!Number.isFinite(row.score) || row.score < 0 || row.score > 100) {
      throw Error('指数分数无效');
    }
    if (row.score >= fearThreshold + 5) {
      armed = true;
    }
    if (armed && previous && previous.score >= fearThreshold && row.score < fearThreshold) {
      armed = false;
      while (tradeIndex < rows.length && rows[tradeIndex].date <= row.date) {
        tradeIndex++;
      }
      // No pre-inception catch-up and no same-day execution using a later published score.
      if (rows.length && row.date >= rows[0].date && tradeIndex < rows.length) {
        signals.push({
          type: 'fear',
          date: rows[tradeIndex].date,
          signalDate: row.date,
          score: row.score,
          previousScore: previous.score,
          fearThreshold,
          rearmThreshold: fearThreshold + 5,
          multiple: 1,
          amount: baseAmount,
          baseAmount
        });
      }
    }
    previous = row;
  }

  return signals;
}
