import {describe,it,expect,vi} from 'vitest';
import type { EChartsType } from 'echarts/core';
import {bindDirectRange} from './direct-range.js';
function fixture(){
 const host=document.createElement('div');document.body.append(host);Object.defineProperty(host,'clientWidth',{value:200});
 let offset=0;const dispatch=vi.fn(),onRange=vi.fn(),clear=vi.fn();
 const chart={setOption:vi.fn(),getOption:()=>({legend:[{selected:{}}],dataZoom:[{start:20,end:80}]}),containPixel:()=>true,convertFromPixel:(_:unknown,x:number)=>Math.round(x/100)+offset,convertToPixel:(_:unknown,x:number)=>(x-offset)*100,on:vi.fn(),dispatchAction:dispatch} as unknown as EChartsType;
 const spec={dates:['a','b','c'],series:[{name:'가격',values:[10,15,20],measure:'relative'},{name:'확률',values:[.1,.5,.8],measure:'pp',scale:100,unit:'%'},{name:'0 시작',values:[0,2,4],measure:'relative'},{name:'음수 시작',values:[-2,-1,4],measure:'relative'},{name:'결측',values:[null,1,2],measure:'relative'}]};
 const api=bindDirectRange(host,chart,spec,onRange,clear);
 const fire=(type:string,x:number,y=100,id=1,extra:Record<string,unknown>={})=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.assign(e,{clientX:x,clientY:y,pointerId:id,pointerType:'mouse',button:0,...extra});host.dispatchEvent(e);};
 return {host,api,fire,onRange,dispatch,output:()=>host.querySelector('.qe-direct-range') as HTMLElement,zoom:()=>{offset=1;}};
}
describe('direct range contract',()=>{
 it('shows start/end and correct changes during the drag before release',()=>{const f=fixture();f.fire('pointerdown',0);f.fire('pointermove',100);expect(f.onRange).toHaveBeenLastCalledWith(0,1);expect(f.output().textContent).toContain('10 → 15  · 50%');expect(f.output().textContent).toContain('10% → 50%  · 40%p');expect(f.output().textContent).toContain('0 → 2  · 2 · 상대 비교 불가');expect(f.output().textContent).toContain('-2 → -1  · 1 · 상대 비교 불가');expect(f.output().textContent).toContain('관측 없음 → 1  · 관측 없음');f.api.dispose();});
 it('normalizes reverse drags and uses current zoom coordinates',()=>{const f=fixture();f.zoom();f.fire('pointerdown',100);f.fire('pointermove',0);expect(f.onRange).toHaveBeenLastCalledWith(1,2);expect(f.output().textContent).toContain('b — c');f.api.dispose();});
 it('does not select during Alt pan or vertical scrolling',()=>{const f=fixture();f.fire('pointerdown',0,0,1,{altKey:true});f.fire('pointermove',100,0);expect(f.onRange).not.toHaveBeenCalled();f.fire('pointerup',100,0);f.fire('pointerdown',0,0);f.fire('pointermove',2,50);f.fire('pointermove',100,70);expect(f.onRange).not.toHaveBeenCalled();expect(f.host.style.touchAction).toBe('pan-y');f.api.dispose();});
 it('suppresses the release click then allows click and Escape to clear',()=>{const f=fixture();f.fire('pointerdown',0);f.fire('pointermove',100);f.fire('pointerup',100);f.fire('click',100);expect(f.output().hidden).toBe(false);f.fire('click',100);expect(f.output().hidden).toBe(true);f.api.present(0,2);f.host.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(f.output().hidden).toBe(true);f.api.dispose();});
 it('maps two pointers to zoom/pan without committing a range',()=>{const f=fixture();f.fire('pointerdown',50,100,1,{pointerType:'touch'});f.fire('pointerdown',150,100,2,{pointerType:'touch'});f.fire('pointermove',190,100,2,{pointerType:'touch'});expect(f.onRange).not.toHaveBeenCalled();expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({type:'dataZoom'}));const z=f.dispatch.mock.calls[0]![0];expect(z.end-z.start).toBeLessThan(60);f.api.dispose();});
});
