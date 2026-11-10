import {describe,it,expect,vi} from 'vitest';
import type { EChartsType } from 'echarts/core';
import {bindDirectRange} from './direct-range.js';
function fixture(){
 const container=document.createElement('section'),host=document.createElement('div');container.append(host);document.body.append(container);Object.defineProperty(host,'clientWidth',{value:200});
 let offset=0;const dispatch=vi.fn(),onRange=vi.fn(),clear=vi.fn();
 const chart={getModel:()=>({getComponent:()=>({coordinateSystem:{getRect:()=>({x:0,width:200})}})}),setOption:vi.fn(),getOption:()=>({legend:[{selected:{}}],dataZoom:[{start:20,end:80}]}),containPixel:()=>true,convertFromPixel:(_:unknown,x:number)=>Math.round(x/100)+offset,convertToPixel:(_:unknown,x:number)=>(x-offset)*100,on:vi.fn(),dispatchAction:dispatch} as unknown as EChartsType;
 const spec={dates:['a','b','c'],series:[{name:'가격',values:[10,15,20],measure:'relative'},{name:'확률',values:[.1,.5,.8],measure:'pp',scale:100,unit:'%'},{name:'0 시작',values:[0,2,4],measure:'relative'},{name:'음수 시작',values:[-2,-1,4],measure:'relative'},{name:'결측',values:[null,1,2],measure:'relative'}]};
 const inspect=vi.fn(),api=bindDirectRange(host,chart,spec,onRange,clear,inspect);
 const fire=(type:string,x:number,y=100,id=1,extra:Record<string,unknown>={})=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.assign(e,{clientX:x,clientY:y,pointerId:id,pointerType:'mouse',button:0,...extra});host.dispatchEvent(e);};
 const touch=(type:string,touches:{clientX:number;clientY:number;identifier:number}[],changedTouches=touches)=>fire('touch'+type,0,0,1,{touches,changedTouches});
 return {host,api,fire,touch,inspect,onRange,dispatch,output:()=>container.querySelector('.qe-direct-range') as HTMLElement,zoom:()=>{offset=1;}};
}
describe('direct range contract',()=>{
 it('shows start/end and correct changes during the drag before release',()=>{const f=fixture();f.fire('pointerdown',0);f.fire('pointermove',100);expect(f.onRange).toHaveBeenLastCalledWith(0,1);expect(f.output().textContent).toContain('10 → 15  · 50%');expect(f.output().textContent).toContain('10% → 50%  · 40%p');expect(f.output().textContent).toContain('0 → 2  · 2 · 상대 비교 불가');expect(f.output().textContent).toContain('-2 → -1  · 1 · 상대 비교 불가');expect(f.output().textContent).toContain('관측 없음 → 1  · 관측 없음');f.api.dispose();});
 it('normalizes reverse drags and uses current zoom coordinates',()=>{const f=fixture();f.zoom();f.fire('pointerdown',100);f.fire('pointermove',0);expect(f.onRange).toHaveBeenLastCalledWith(1,2);expect(f.output().textContent).toContain('b — c');f.api.dispose();});
 it('keeps an early vertical touch available for scrolling and leaves Alt-pan to the renderer',()=>{
  const f=fixture();f.fire('pointerdown',0,0,1,{altKey:true});f.fire('pointermove',100,0);f.fire('pointerup',100,0);
  const at=(clientX:number,clientY:number)=>({clientX,clientY,identifier:1});
  f.touch('start',[at(0,0)]);f.touch('move',[at(2,50)]);f.touch('move',[at(100,70)]);f.touch('cancel',[],[at(100,70)]);
  expect(f.onRange).not.toHaveBeenCalled();expect(f.inspect).not.toHaveBeenCalled();expect(f.host.style.touchAction).toBe('pan-y');f.api.dispose();
 });
 it('suppresses the release click then allows click and Escape to clear',()=>{const f=fixture();f.fire('pointerdown',0);f.fire('pointermove',100);f.fire('pointerup',100);f.fire('click',100);expect(f.output().hidden).toBe(false);f.fire('click',100);expect(f.output().hidden).toBe(true);f.api.present(0,2);f.host.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(f.output().hidden).toBe(true);f.api.dispose();});
 it('pinches without committing a range',()=>{
  const f=fixture(),a={clientX:50,clientY:100,identifier:1},b={clientX:150,clientY:100,identifier:2};
  f.touch('start',[a]);f.touch('start',[a,b]);f.touch('move',[a,{...b,clientX:190}]);
  expect(f.onRange).not.toHaveBeenCalled();expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({type:'dataZoom'}));
  const z=f.dispatch.mock.calls[0]![0].batch[0];expect(z.end-z.start).toBeLessThan(60);f.api.dispose();
 });
});
