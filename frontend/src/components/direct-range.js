import * as touch from './touch-chart.js';

// Direct range interaction. Native vertical touch scrolling remains available.
export function bindDirectRange(host, chart, spec, onRange, onClear, onInspect){
 if(!host.addEventListener)return {clear(){},dispose(){}};
 const doc=host.ownerDocument,output=doc.createElement('div'),band=doc.createElement('div');
 output.className='qe-direct-range';output.setAttribute('aria-live','polite');output.hidden=true;
 output.dataset.quantChartReadout='';
 host.after(output);
 Object.assign(band.style,{position:'absolute',top:'28px',bottom:'28px',background:'rgba(96,200,210,.13)',borderLeft:'1px solid #60c8d2',borderRight:'1px solid #60c8d2',pointerEvents:'none',zIndex:'2'});band.hidden=true;
 host.style.position='relative';host.style.touchAction='pan-y';host.style.userSelect='none';host.append(band);
 let drag=null,range=null,suppress=false;
 const index=x=>Math.max(0,Math.min(spec.dates.length-1,Math.round(chart.convertFromPixel({xAxisIndex:0},x))));
 const local=e=>{const rect=host.getBoundingClientRect();return [e.clientX-rect.left,e.clientY-rect.top];};
 const hit=(point,clamp)=>clamp||chart.containPixel({gridIndex:'all'},point)?index(point[0]):null;
 const draw=()=>{if(!range)return;const x=range.map(i=>chart.convertToPixel({xAxisIndex:0},i));band.style.left=Math.min(...x)+'px';band.style.width=Math.max(1,Math.abs(x[1]-x[0]))+'px';};
 const format=(v,s)=>Number.isFinite(v)?(v*(s.scale||1)).toLocaleString('ko-KR',{maximumFractionDigits:2})+(s.unit||''):'관측 없음';
 const clear=()=>{chart.setOption({tooltip:{showContent:true}});range=null;band.hidden=true;output.hidden=true;onClear?.();};
 const present=(a,b)=>{chart.setOption({tooltip:{showContent:false}});chart.dispatchAction({type:'hideTip'});range=[Math.min(a,b),Math.max(a,b)];const [lo,hi]=range;output.replaceChildren();const heading=doc.createElement('strong');heading.textContent=spec.dates[lo]+' — '+spec.dates[hi];output.append(heading);
  for(const s of spec.series){if(chart.getOption().legend?.[0]?.selected?.[s.legendName||s.name]===false)continue;const x=s.values[lo],y=s.values[hi],valid=typeof x==='number'&&typeof y==='number'&&Number.isFinite(x)&&Number.isFinite(y);let change='관측 없음';if(valid){const delta=(y-x)*(s.scale||1);change=s.measure==='pp'?delta.toLocaleString('ko-KR',{maximumFractionDigits:2})+'%p':s.measure==='absolute'?delta.toLocaleString('ko-KR',{maximumFractionDigits:2})+(s.unit||''):x>0?((y/x-1)*100).toLocaleString('ko-KR',{maximumFractionDigits:2})+'%':delta.toLocaleString('ko-KR',{maximumFractionDigits:2})+(s.unit||'')+' · 상대 비교 불가';}const row=doc.createElement('span');row.textContent=s.name+'  '+format(x,s)+' → '+format(y,s)+'  · '+change;output.append(row);}
  band.hidden=false;output.hidden=false;draw();onRange?.(lo,hi);
 };
 const bindTouch=touch;
 const touchCleanup=bindTouch?.bindTouchChart(host,{
   hit,inspect:i=>{if(onInspect)onInspect(i);else chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:i});},
   compare:present,clear,rangeReadout:()=>output,navigate:(a,b)=>bindTouch.navigateECharts(chart,a,b)
 });
 const down=e=>{if(e.button!==0||e.pointerType==='touch')return;suppress=false;if(e.altKey)return;const value=hit(local(e));if(value!=null)drag={id:e.pointerId,x:e.clientX,index:value,active:false};};
 const move=e=>{if(!drag||drag.id!==e.pointerId||(!drag.active&&Math.abs(e.clientX-drag.x)<6))return;if(!drag.active){drag.active=true;try{host.setPointerCapture?.(e.pointerId);}catch{}}e.preventDefault();e.stopImmediatePropagation();present(drag.index,index(local(e)[0]));};
 const up=e=>{if(drag?.id!==e.pointerId)return;suppress=drag.active;drag=null;};
 const click=e=>{if(suppress){e.preventDefault();e.stopImmediatePropagation();suppress=false;}else if(hit(local(e))!=null)clear();};
 const key=e=>{if(e.key==='Escape')clear();};
 host.addEventListener('pointerdown',down,true);host.addEventListener('pointermove',move,{capture:true,passive:false});host.addEventListener('pointerup',up,true);host.addEventListener('pointercancel',up,true);host.addEventListener('click',click,true);host.addEventListener('keydown',key,true);
 chart.on('datazoom',draw);chart.on('legendselectchanged',()=>{if(range)present(...range);});
 const resizeRange=typeof ResizeObserver!=='undefined'?new ResizeObserver(draw):null;resizeRange?.observe(host);
 return {clear,present,dispose(){touchCleanup?.();resizeRange?.disconnect();for(const [type,fn]of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['click',click],['keydown',key]])host.removeEventListener(type,fn,true);band.remove();output.remove();}};
}
