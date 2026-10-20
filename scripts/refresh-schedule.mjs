import { scheduledSources } from '../server/refresh-schedule.mjs';

console.log('sources=' + scheduledSources(process.env.REFRESH_SCHEDULE).join(','));
