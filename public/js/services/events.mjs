// Application-local notifications; no feature publishes onto the browser window.
export const appEvents=new EventTarget();
export const events=Object.freeze({marketCalendar:'market-calendar',marketHover:'market-hover',strategySettings:'strategy-settings',sourceHealth:'source-health'});
