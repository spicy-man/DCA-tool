import {initKDControls} from './features/strategy/kd.mjs';
import {initBacktest} from './features/strategy/backtest.mjs';
import {initAllocationDialog} from './features/strategy/allocation-dialog.mjs';
import {initFloatingCharts} from './ui/floating-charts.mjs';
import {initApplication} from './application.mjs';
import {initMarketChart} from './features/market/chart.mjs';
import {initStrategyOverlay} from './features/strategy/overlay.mjs';
import {initStrategyDialog} from './ui/strategy-dialog.mjs';
import {initWelcomeDialog} from './ui/welcome-dialog.mjs';
import {initChartVisibility} from './ui/chart-visibility.mjs';
import {initSymbolDialog} from './ui/symbol-dialog.mjs';
import {initFundNavigation} from './ui/fund-navigation.mjs';
import {initChannelNavigation} from './ui/channel-navigation.mjs';
import {initPlanEstimateHelp} from './ui/plan-estimate-help.mjs';
import {bindDialogCommands} from './ui/dialog-utils.mjs';
import {getDeploymentInfo} from './services/data-client.mjs';

// Phase 1: Resolve deployment mode once and populate custom <select id="symbol"> options
// before strategy/market modules read saved symbol preferences.
bindDialogCommands();
const deploymentInfo = await getDeploymentInfo();
await initSymbolDialog({ deploymentInfo });

// Phase 2: Register controls, views, and event subscribers before triggering data fetches.
// Note: initChartVisibility() must run before initFloatingCharts().
initPlanEstimateHelp();
initKDControls();
initBacktest();
initStrategyOverlay({ includeSubmodules: false });
initAllocationDialog();
initMarketChart();
initChartVisibility();
initFundNavigation();
initChannelNavigation();
const openStrategyDialog = initStrategyDialog();

// Phase 3: Start data loading, timeline coordination, floating mini-charts, and welcome dialog.
initApplication({ deploymentInfo });
initFloatingCharts();
initWelcomeDialog({ openStrategyDialog });
