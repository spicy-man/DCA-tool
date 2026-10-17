// Shared two-column tooltip layout. Colors and surface treatment come from the app theme.
export function tooltipContent(tip,{title,rows,footer}){
 tip.replaceChildren();if(title){const heading=document.createElement('div');heading.className='tooltip-heading';heading.textContent=title;tip.append(heading);}
 const grid=document.createElement('dl');grid.className='tooltip-grid';for(const [label,value] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;grid.append(dt,dd);}tip.append(grid);
 if(footer){const note=document.createElement('div');note.className='tooltip-footer';note.textContent=footer;tip.append(note);}
}
export function positionTooltip(tip,x,y,width){tip.hidden=false;tip.style.left=Math.max(0,Math.min(x+14,width-tip.offsetWidth-5))+'px';tip.style.top=Math.max(0,y-tip.offsetHeight-12)+'px';}
