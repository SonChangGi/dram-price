import type { EChartsType } from "echarts/core";
export function bindDirectRange(host: HTMLElement, chart: EChartsType, spec: {dates:string[];series:Array<{name:string;values:Array<number|null>;measure:string;unit?:string;scale?:number}>}, onRange?:(a:number,b:number)=>void, onClear?:()=>void):{clear():void;present(a:number,b:number):void;dispose():void};
