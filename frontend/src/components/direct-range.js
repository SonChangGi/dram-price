import * as touch from './touch-chart.js';
import './range-readout.js';

// Direct range interaction. Native vertical touch scrolling remains available.
export function bindDirectRange(host, chart, spec, onRange, onClear, onInspect){
 if(!host.addEventListener)return {clear(){},dispose(){}};
 const doc=host.ownerDocument,output=doc.createElement('div'),band=doc.createElement('div');
 output.className='qe-direct-range';output.setAttribute('aria-live','polite');output.hidden=true;
 output.dataset.quantChartReadout='';
 host.after(output);
 const presentation=globalThis.QuantRangeReadout;
 const presenter=presentation?.createRangeReadout(host,output);
 Object.assign(band.style,{position:'absolute',inset:'0',pointerEvents:'none',zIndex:'2',overflow:'hidden'});band.hidden=true;
 host.style.position='relative';host.style.touchAction='pan-y';host.style.userSelect='none';host.append(band);
 let drag=null,range=null,suppress=false;
 const index=x=>Math.max(0,Math.min(spec.dates.length-1,Math.round(chart.convertFromPixel({xAxisIndex:0},x))));
 const local=e=>{const rect=host.getBoundingClientRect();return [e.clientX-rect.left,e.clientY-rect.top];};
 const hit=(point,clamp)=>clamp||chart.containPixel({gridIndex:'all'},point)?index(point[0]):null;
 const visible=()=>spec.series.filter(s=>chart.getOption().legend?.[0]?.selected?.[s.legendName||s.name]!==false);
 const pixels=axis=>range.map(i=>chart.convertToPixel({xAxisIndex:axis},i));
 const geometry=()=>presentation?.echartsGeometry(chart,pixels(0),visible().filter(s=>!s.panel).flatMap(s=>range.flatMap(i=>
   Number.isFinite(s.values[i])?[chart.convertToPixel({gridIndex:0},[i,s.values[i]])]:[])));
 const draw=()=>{
   if(!range)return;
   band.replaceChildren();
   const grids=chart.getOption().grid||[];
   for(let i=0;i<grids.length;i++){
     const box=presentation?.echartsGeometry(chart,null,null,i)?.bounds;
     if(!box)continue;
     const [a,b]=pixels(i),left=Math.max(box.left,a),right=Math.min(box.left+box.width,b);
     if(right<left)continue;
     const mark=doc.createElement('span');
     Object.assign(mark.style,{position:'absolute',left:left+'px',top:box.top+'px',width:Math.max(1,right-left)+'px',height:box.height+'px',
       background:'color-mix(in srgb,var(--qs-accent,#78d9e1) 13%,transparent)',borderInline:'1px solid color-mix(in srgb,var(--qs-accent,#78d9e1) 70%,transparent)'});
     band.append(mark);
   }
   presenter?.place(geometry());
 };
 const format=(v,s)=>Number.isFinite(v)?(v*(s.scale||1)).toLocaleString('ko-KR',{maximumFractionDigits:2})+(s.unit||''):'관측 없음';
 const clear=()=>{if(range)chart.setOption({tooltip:{showContent:true}});range=null;band.hidden=true;presenter?.clear();output.hidden=true;onClear?.();};
 const present=(a,b)=>{
   if(!Number.isFinite(a)||!Number.isFinite(b))return;
   if(!range)chart.setOption({tooltip:{showContent:false}});chart.dispatchAction({type:'hideTip'});
   range=[Math.min(a,b),Math.max(a,b)].map(i=>Math.max(0,Math.min(spec.dates.length-1,Math.round(i))));
   const [lo,hi]=range;
   const items=visible().map(s=>{
     const x=s.values[lo],y=s.values[hi],valid=Number.isFinite(x)&&Number.isFinite(y);
     const useRatio=s.measure!=='pp'&&s.measure!=='absolute';
     const relative=useRatio&&x>0,delta=!valid?null:relative?(y/x-1)*100:(y-x)*(s.scale||1);
     const unit=s.measure==='pp'?'%p':relative?'%':s.unit||'';
     const change=presentation?.signedChange(delta,unit)??(delta==null?'—':delta.toLocaleString('ko-KR',{maximumFractionDigits:2})+unit);
     return {name:s.name,change:valid&&useRatio&&!relative?'Δ '+change:change,
       detail:format(x,s)+' → '+format(y,s)+(valid&&useRatio&&!relative?' · 상대 변화율 미제공':''),color:s.color};
   });
   const start=spec.dates[lo],end=spec.dates[hi];
   band.hidden=false;draw();
   if(presenter)presenter.show({start,end,items,dense:new Set(visible().map(s=>s.panel||0)).size>1},geometry());
   else{output.textContent=start+' → '+end+' · '+items.map(i=>i.name+' '+i.detail+' · '+i.change).join(' · ');output.hidden=false;}
   onRange?.(lo,hi);
 };
 const refresh=()=>{if(range){chart.setOption({tooltip:{showContent:false}});draw();}};
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
 chart.on('datazoom',draw);for(const event of ['legendselectchanged','legendselected','legendunselected'])chart.on(event,()=>{if(range)present(...range);});
 const resizeRange=typeof ResizeObserver!=='undefined'?new ResizeObserver(draw):null;resizeRange?.observe(host);
 return {clear,present,refresh,dispose(){touchCleanup?.();resizeRange?.disconnect();for(const [type,fn]of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['click',click],['keydown',key]])host.removeEventListener(type,fn,true);band.remove();presenter?.destroy();output.remove();}};
}
