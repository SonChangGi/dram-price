/* Quant design engine 0.4.0: presentation adaptation only. */
(()=>{
 const doc=document, view=doc.defaultView; if(!view)return;
 const enhance=()=>{
  for(const ui of doc.querySelectorAll('.qr-measure')){
   const toolbar=ui.querySelector(':scope > .qr-toolbar');
   if(toolbar){const details=doc.createElement('details');details.className='qe-native-tools';const summary=doc.createElement('summary');summary.textContent='측정 도구';details.append(summary);toolbar.before(details);details.append(toolbar);}
   const status=ui.querySelector<HTMLElement>('.qr-readout');if(status)status.classList.add('sr-only');
  }
  for(const button of doc.querySelectorAll('[data-export-table]')) {
   if(button.closest('.qe-table-tools')) continue;
   const details=doc.createElement('details');details.className='qe-table-tools';
   const summary=doc.createElement('summary');summary.textContent='표 도구';details.append(summary);button.before(details);details.append(button);
  }
  for(const input of doc.querySelectorAll<HTMLInputElement>('[data-filter-table]')) {
   if(input.dataset.qeClear)continue;input.dataset.qeClear='true';
   const clear=doc.createElement('button');clear.type='button';clear.className='qe-filter-clear';clear.textContent='검색 해제';clear.hidden=!input.value;
   clear.addEventListener('click',()=>{input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();});
   input.addEventListener('input',()=>{clear.hidden=!input.value;});input.after(clear);
  }
  for(const region of doc.querySelectorAll<HTMLElement>('.table-scroll,.table-wrap,.table-wrapper')) {
   if(!region.querySelector('table'))continue;
   if(!region.hasAttribute('tabindex'))region.tabIndex=0;
   if(!region.hasAttribute('role'))region.setAttribute('role','region');
   if(!region.hasAttribute('aria-label'))region.setAttribute('aria-label',region.querySelector('caption')?.textContent.trim()||'데이터 표');
  }
  for(const facet of doc.querySelectorAll('.chart-facet')){
   const caption=facet.querySelector('figcaption');
   if(caption&&!caption.querySelector('.qe-native-tools')){const details=doc.createElement('details');details.className='qe-native-tools';const summary=doc.createElement('summary');summary.textContent='차트 도구';details.append(summary);caption.append(details);}
  }
 };
 let pending=false;new view.MutationObserver(()=>{if(pending)return;pending=true;view.requestAnimationFrame(()=>{pending=false;enhance();});}).observe(doc.body,{childList:true,subtree:true});enhance();
})();

export {};
