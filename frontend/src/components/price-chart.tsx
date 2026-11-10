import { bindDirectRange } from './direct-range.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, DataZoomComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
echarts.use([LineChart,GridComponent,TooltipComponent,DataZoomComponent,SVGRenderer]);
import { formatDate, formatPrice, kindLabel, metricFor, priceUnitFor, priceUnitLabel, sourceLabel } from '@/lib/market';
import type { Observation } from '@/types';

const MAX_SERIES = 5;
const PALETTE = ['#3182f6', '#008f7a', '#c56b12', '#7c5ce7', '#0891b2'];
const FALLBACK_COLOR = '#3182f6';

interface ChartGroup {
  id: string;
  label: string;
  displayLabel: string;
  source: string;
  cadence: string;
  currency: string;
  points: Array<{ date: string; value: number }>;
}

interface FacetDefinition {
  id: string;
  kind: string;
  currency: string;
  unit: ReturnType<typeof priceUnitFor>;
  metricKey: string;
  metricLabel: string;
  rows: Observation[];
}

function allGroups(rows: Observation[], metricKey: string): ChartGroup[] {
  const groups = new Map<string, Omit<ChartGroup, 'displayLabel' | 'points'> & { pointsByDate: Map<string, number> }>();
  rows.forEach((row) => {
    const point = metricFor(row, metricKey);
    if (!point || !row.date) return;
    const id = `${row.source}|${row.kind}|${row.product_id}|${row.cadence}`;
    const group = groups.get(id) ?? {
      id,
      label: row.product_name,
      source: row.source,
      cadence: row.cadence ?? '',
      currency: row.currency ?? '',
      pointsByDate: new Map<string, number>(),
    };
    group.pointsByDate.set(row.date, point.value);
    groups.set(id, group);
  });
  const normalized = [...groups.values()].map(({ pointsByDate, ...group }) => ({
    ...group,
    displayLabel: group.label,
    points: [...pointsByDate.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)),
  }));
  const duplicateLabels = new Map<string, number>();
  normalized.forEach((group) => duplicateLabels.set(group.label, (duplicateLabels.get(group.label) ?? 0) + 1));
  const cadenceLabel = (cadence: string) => ({ daily: '일간', weekly: '주간', monthly: '월간' })[cadence] ?? cadence;
  return normalized
    .map((group) => ({
      ...group,
      displayLabel: (duplicateLabels.get(group.label) ?? 0) > 1
        ? `${group.label} · ${sourceLabel(group.source)} · ${cadenceLabel(group.cadence)}`
        : group.label,
    }))
    .sort((a, b) => (b.points.at(-1)?.date ?? '').localeCompare(a.points.at(-1)?.date ?? '') || a.label.localeCompare(b.label));
}

function facetDefinitions(rows: Observation[], requestedMetric: string): FacetDefinition[] {
  const facets = new Map<string, FacetDefinition>();
  rows.forEach((row) => {
    const point = metricFor(row, requestedMetric);
    if (!point) return;
    const currency = row.currency || 'USD';
    const unit = priceUnitFor(row);
    const id = `${row.kind}|${currency}|${point.key}|${unit}`;
    const facet = facets.get(id) ?? { id, kind: row.kind, currency, unit, metricKey: point.key, metricLabel: point.label, rows: [] };
    facet.rows.push(row);
    facets.set(id, facet);
  });
  const kindOrder = ['spot', 'contract', 'spot_proxy'];
  return [...facets.values()].sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.metricLabel.localeCompare(b.metricLabel));
}

function ChartFacet({facet}:{facet:FacetDefinition}){
 const plot=useRef<HTMLDivElement>(null),instance=useRef<echarts.EChartsType|null>(null);
 const groups=useMemo(()=>allGroups(facet.rows,facet.metricKey).filter(g=>g.points.length>=2).slice(0,MAX_SERIES),[facet]);
 const dates=useMemo(()=>[...new Set(groups.flatMap(g=>g.points.map(p=>p.date)))].sort(),[groups]);
 const [date,setDate]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null),[zoomed,setZoomed]=useState(false);
 const [rangeStart,setRangeStart]=useState(''),[rangeEnd,setRangeEnd]=useState('');
 const rangeControl=useRef<ReturnType<typeof bindDirectRange>|null>(null);
 const [hoveredDate,setHoveredDate]=useState<string|null>(null),[hovered,setHovered]=useState<string|null>(null);
 const groupKey=groups.map(g=>g.id).join('|');const [selectionKey,setSelectionKey]=useState(groupKey);
 if(selectionKey!==groupKey){setSelectionKey(groupKey);setSelected(null);setHovered(null);setHoveredDate(null);}
 const activeId=groups.some(g=>g.id===(hovered||selected))?(hovered||selected):null;
 const activeDates=groups.find(g=>g.id===activeId)?.points.map(p=>p.date)||dates;
 const requestedDate=hoveredDate||date||dates.at(-1)||'';
 const activeDate=activeDates.includes(requestedDate)?requestedDate:activeDates.reduce((best,d)=>Math.abs(Date.parse(d)-Date.parse(requestedDate))<Math.abs(Date.parse(best)-Date.parse(requestedDate))?d:best,activeDates.at(-1)||'');
 useEffect(()=>{
  const host=plot.current;if(!host||!dates.length)return;
  const chart=echarts.init(host,null,{renderer:'svg'});instance.current=chart;
  const option=()=>{const style=getComputedStyle(document.documentElement),muted=style.getPropertyValue('--muted').trim()||'#a6b4b6',line=style.getPropertyValue('--line').trim()||'#344247',text=style.getPropertyValue('--ink').trim()||'#edf3f2',panel=style.getPropertyValue('--panel').trim()||'#171d20';return {
   animation:false,grid:{left:12,right:38,top:38,bottom:30,containLabel:true},textStyle:{fontFamily:'Pretendard, sans-serif',color:text},
   tooltip:{trigger:'axis' as const,confine:true,backgroundColor:panel,borderColor:line,textStyle:{color:text,fontSize:12},valueFormatter:(value:unknown)=>typeof value==='number'?formatPrice(value,facet.currency):'관측 없음'},
   xAxis:{type:'category' as const,data:dates,boundaryGap:false,axisLabel:{color:muted,hideOverlap:true,fontSize:11,formatter:(v:string)=>v.slice(2)},axisTick:{show:false},axisLine:{lineStyle:{color:line}}},
   yAxis:{type:'value' as const,min:0,name:`${priceUnitLabel(facet.unit)} · ${facet.currency}`,nameTextStyle:{color:muted,fontSize:11},splitNumber:4,axisLabel:{color:muted,fontSize:11},splitLine:{lineStyle:{color:line,type:'dashed' as const}}},
   dataZoom:[{type:'inside' as const,filterMode:'none' as const,preventDefaultMouseMove:false,moveOnMouseMove:'alt' as const}],
   series:groups.map((group,index)=>({id:group.id,name:group.displayLabel,type:'line' as const,showSymbol:false,connectNulls:false,data:dates.map(d=>group.points.find(p=>p.date===d)?.value??null),lineStyle:{width:2.4,color:PALETTE[index%PALETTE.length]},itemStyle:{color:PALETTE[index%PALETTE.length]},emphasis:{focus:'series' as const}}))
  };};
  chart.setOption(option());
  const direct=bindDirectRange(host,chart,{dates,series:groups.map(g=>({name:g.displayLabel,values:dates.map(d=>g.points.find(p=>p.date===d)?.value??null),measure:'relative',unit:' '+facet.currency}))});
  rangeControl.current=direct;
  chart.getZr().on('click',event=>{const index=Math.round(chart.convertFromPixel({xAxisIndex:0},event.offsetX) as number);if(dates[index]){setDate(dates[index]);setHoveredDate(null);}});
  chart.on('updateAxisPointer',(event:unknown)=>{const p=event as {axesInfo?:Array<{value:number}>};const index=p.axesInfo?.[0]?.value;if(index!==undefined&&dates[index])setHoveredDate(dates[index]);});
  chart.getZr().on('globalout',()=>setHoveredDate(null));
  chart.on('datazoom',()=>{const state=chart.getOption().dataZoom as Array<{start:number;end:number}>;setZoomed(Boolean(state?.[0]&&(state[0].start>0||state[0].end<100)));});
  const resize=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>chart.resize()):null;resize?.observe(host);
  const theme=new MutationObserver(()=>{const zoom=chart.getOption().dataZoom;chart.setOption({...option(),dataZoom:zoom},true);});theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  return()=>{resize?.disconnect();theme.disconnect();direct.dispose();chart.dispose();rangeControl.current=null;instance.current=null;};
 },[dates,groups,facet.currency,facet.unit]);
 useEffect(()=>{const chart=instance.current;if(!chart)return;chart.dispatchAction({type:'downplay'});if(activeId)chart.dispatchAction({type:'highlight',seriesId:activeId});},[activeId]);
 if(!groups.length)return <figure className="chart-facet chart-facet--sparse"><figcaption><strong>{kindLabel(facet.kind)} · {facet.metricLabel}</strong><span>{priceUnitLabel(facet.unit)} · {facet.currency}</span></figcaption><div className="empty-state">가격 추이를 그리려면 같은 제품에 날짜가 다른 관측치가 2개 이상 필요합니다.</div></figure>;
 return <figure className="chart-facet qe-price-facet">
  <figcaption><div><strong>{kindLabel(facet.kind)} · {facet.metricLabel}</strong><span>{formatDate(dates[0])}–{formatDate(dates.at(-1))} · {groups.length}/{allGroups(facet.rows,facet.metricKey).filter(g=>g.points.length>=2).length}개 시리즈</span></div>{zoomed&&<button type="button" onClick={()=>instance.current?.dispatchAction({type:'dataZoom',start:0,end:100})}>전체 보기</button>}</figcaption>
  <div className="qe-price-plot" ref={plot} role="img" aria-label={`${kindLabel(facet.kind)} ${facet.metricLabel} 가격 추이`} tabIndex={0} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const index=Math.max(0,Math.min(activeDates.length-1,e.key==='Home'?0:e.key==='End'?activeDates.length-1:activeDates.indexOf(activeDate)+(e.key==='ArrowLeft'?-1:1)));setDate(activeDates[index]!);setHoveredDate(null);instance.current?.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:dates.indexOf(activeDates[index]!)});}}/>
  <div className="chart-series-controls" role="group" aria-label={`${kindLabel(facet.kind)} 정확값을 확인할 시리즈 선택`}>{groups.map((group,index)=><button type="button" key={group.id} aria-pressed={activeId===group.id} onClick={()=>setSelected(selected===group.id?null:group.id)} onPointerEnter={()=>setHovered(group.id)} onPointerLeave={()=>setHovered(null)}><i style={{background:PALETTE[index%PALETTE.length]||FALLBACK_COLOR}}/><span>{group.displayLabel}</span></button>)}</div>
  <div className="qe-price-readout" data-date={activeDate} aria-live="polite"><strong>{formatDate(activeDate)}</strong>{groups.filter(g=>!activeId||g.id===activeId).map(group=>{const value=group.points.find(p=>p.date===activeDate)?.value;return <span key={group.id}>{group.displayLabel}<b>{value==null?'관측 없음':formatPrice(value,facet.currency)}</b></span>;})}</div>
  <details className="qe-price-options"><summary>차트 옵션</summary><label>선택일<select aria-label={`${kindLabel(facet.kind)} 차트 고정 선택일`} value={activeDate} onChange={e=>{setDate(e.target.value);setHoveredDate(null);}}>{activeDates.slice().reverse().map(d=><option key={d} value={d}>{formatDate(d)}</option>)}</select></label><button type="button" onClick={()=>setDate(dates.at(-1)!)}>차트 최신일</button><fieldset><legend>구간 수익률</legend><input type="date" aria-label="구간 시작" min={dates[0]} max={dates.at(-1)} value={rangeStart||dates[0]} onChange={e=>setRangeStart(e.target.value)}/><input type="date" aria-label="구간 종료" min={dates[0]} max={dates.at(-1)} value={rangeEnd||dates.at(-1)} onChange={e=>setRangeEnd(e.target.value)}/><button type="button" onClick={()=>{const a=rangeStart||dates[0]!,b=rangeEnd||dates.at(-1)!;const first=dates.findIndex(d=>d>=a),last=dates.length-1-[...dates].reverse().findIndex(d=>d<=b);if(a<b&&first>=0&&last>=first)rangeControl.current?.present(first,last);else rangeControl.current?.clear();}}>적용</button><button type="button" onClick={()=>rangeControl.current?.clear()}>해제</button></fieldset></details>

 </figure>;
}

export function PriceChart({rows,metric}:{rows:Observation[];metric:string}){
 const facets=useMemo(()=>facetDefinitions(rows,metric),[rows,metric]);
 return <div className="chart-stack">{facets.map(f=><ChartFacet key={f.id} facet={f}/>)}{!facets.length&&<div className="empty-state">선택 조건에서 표시할 유효 평균 가격이 없습니다.</div>}</div>;
}

