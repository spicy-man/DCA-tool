import {initFloatingCharts} from './ui/floating-charts.mjs';
import {initApplication} from './application.mjs';
import {initMarketChart} from './features/market/chart.mjs';
import {initStrategyOverlay} from './features/strategy/overlay.mjs';
import {initStrategyDialog} from './ui/strategy-dialog.mjs';
import {initWelcomeDialog} from './ui/welcome-dialog.mjs';
import {initChartVisibility} from './ui/chart-visibility.mjs';
import {initSymbolDialog} from './ui/symbol-dialog.mjs';
import {initFundNavigation} from './ui/fund-navigation.mjs';

// Composition root: initialize feature controls before starting data loading.
await initSymbolDialog();
initStrategyOverlay();
initMarketChart();
initChartVisibility();
initFundNavigation();
const openStrategyDialog = initStrategyDialog();
initApplication();

initFloatingCharts();
initWelcomeDialog({ openStrategyDialog });
