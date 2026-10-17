import {rating} from './data.mjs';
const sentimentNames={'Extreme Fear':'极度恐慌',Fear:'恐慌',Neutral:'中性',Greed:'贪婪','Extreme Greed':'极度贪婪'};
export const sentimentLabel=score=>sentimentNames[rating(score)];
export const sourceLabel=source=>source==='CNN official'?'CNN 官方接口':source==='Historical archive'?'历史存档':source;

