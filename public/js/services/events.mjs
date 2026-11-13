// Application-local notifications; no feature publishes onto the browser window.
export const appEvents=new EventTarget();
export const events=Object.freeze({replayRange:'replay-range',marketCalendar:'market-calendar',marketHover:'market-hover',strategySettings:'strategy-settings',symbolSettings:'symbol-settings',strategyView:'strategy-view',sourceHealth:'source-health',fundsUpdated:'funds-updated'});
