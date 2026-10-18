import {initFloatingCharts} from './ui/floating-charts.mjs';
import {initApplication} from './application.mjs';
import {initMarketChart} from './features/market/chart.mjs';
import {initStrategyOverlay} from './features/strategy/overlay.mjs';
import {initStrategyDialog} from './ui/strategy-dialog.mjs';

// Composition root: initialize feature controls before starting data loading.
initStrategyOverlay();
initMarketChart();
initStrategyDialog();
initApplication();

initFloatingCharts();
